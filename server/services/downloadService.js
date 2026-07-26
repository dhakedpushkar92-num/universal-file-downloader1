/**
 * services/downloadService.js
 * ------------------------------------------------------------
 * Business logic for fetching remote file metadata and for
 * streaming a remote file back to the client. Kept separate
 * from the controller so it stays unit-testable and reusable.
 *
 * IMPORTANT SCOPE / ETHICS NOTE:
 * This service performs only plain, unauthenticated HTTP(S)
 * requests using the URL exactly as supplied by the user. It
 * does not send cookies, auth tokens, or custom headers meant
 * to impersonate a logged-in session; it does not solve
 * CAPTCHAs; it does not attempt to defeat Cloudflare or similar
 * bot-protection challenges; and it never follows redirects
 * into private network ranges. If a remote server requires
 * authentication or returns a bot-challenge page, the request
 * is simply reported back to the user as failed/blocked.
 * ------------------------------------------------------------
 */

const axios = require('axios');
const { validateUrl } = require('../utils/urlValidator');
const {
  extractFilenameFromHeader,
  extractFilenameFromUrl,
  sanitizeFilename,
  getExtension,
  formatBytes,
} = require('../utils/fileHelpers');
const { isMediaFireUrl, resolveMediaFireFile } = require('../utils/mediafireResolver');
const logger = require('../utils/logger');

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 15_000;
const MAX_FILE_SIZE_BYTES =
  parseInt(process.env.MAX_FILE_SIZE_BYTES, 10) || 2 * 1024 * 1024 * 1024; // 2GB
const MAX_REDIRECTS = 5;

// A conservative, honest User-Agent. We identify as what we are —
// a server-side downloader tool — rather than spoofing a browser
// to slip past bot detection.
const USER_AGENT = 'UniversalFileDownloader/1.0 (+https://example.com)';

/**
 * Validates a URL and throws a descriptive error if it fails,
 * including re-checking any redirect target (handled by axios
 * internally via maxRedirects + beforeRedirect hook below).
 */
async function assertSafeUrl(rawUrl) {
  const result = await validateUrl(rawUrl);
  if (!result.valid) {
    const err = new Error(result.reason);
    err.statusCode = 400;
    throw err;
  }
  return result.url;
}

/**
 * Resolves a user-supplied URL to the URL we should actually
 * request the file bytes from, plus any extra metadata gathered
 * along the way (currently: MediaFire share-page resolution).
 *
 * For a normal direct-file URL this is a no-op passthrough.
 * For a MediaFire "file" page, it loads the public page and
 * extracts MediaFire's own static download link — see
 * utils/mediafireResolver.js for the exact rules and limits.
 */
async function resolveSourceUrl(rawUrl) {
  if (isMediaFireUrl(rawUrl)) {
    const resolved = await resolveMediaFireFile(rawUrl);
    logger.info(`Resolved MediaFire page ${rawUrl} -> ${resolved.directUrl}`);
    return {
      targetUrl: resolved.directUrl,
      source: 'mediafire',
      originalUrl: rawUrl,
      pageFilename: resolved.filename,
      pageSizeHuman: resolved.sizeHuman,
    };
  }
  return { targetUrl: rawUrl, source: 'direct', originalUrl: rawUrl };
}

/**
 * Performs a HEAD request (falling back to a ranged GET if HEAD
 * is not supported) to gather metadata without downloading the
 * full file body.
 */
async function fetchFileInfo(rawUrl) {
  const resolved = await resolveSourceUrl(rawUrl);
  const targetUrl = resolved.targetUrl;

  await assertSafeUrl(targetUrl);

  const requestConfig = {
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    validateStatus: () => true, // we handle status codes ourselves
    headers: { 'User-Agent': USER_AGENT },
    // Re-validate every redirect hop to prevent SSRF via redirect chains.
    beforeRedirect: async (options) => {
      const target = `${options.protocol}//${options.hostname}${options.path}`;
      const check = await validateUrl(target);
      if (!check.valid) {
        throw new Error(`Redirect blocked: ${check.reason}`);
      }
    },
  };

  let response;
  try {
    response = await axios.head(targetUrl, requestConfig);
  } catch (err) {
    throw normalizeAxiosError(err);
  }

  // Some servers (misconfigured or otherwise) reject HEAD requests.
  // Fall back to a tiny ranged GET to still recover headers.
  if (response.status >= 400 || response.status === 405) {
    try {
      response = await axios.get(targetUrl, {
        ...requestConfig,
        headers: { ...requestConfig.headers, Range: 'bytes=0-0' },
        responseType: 'stream',
      });
      // We only needed the headers — destroy the stream immediately.
      response.data.destroy();
    } catch (err) {
      throw normalizeAxiosError(err);
    }
  }

  if (response.status >= 400) {
    const err = new Error(
      `The remote server responded with status ${response.status}. The file may require authentication, may not exist, or access may be restricted.`
    );
    err.statusCode = 502;
    throw err;
  }

  const meta = buildMetadata(targetUrl, response);

  // For MediaFire links, the CDN response frequently omits a useful
  // Content-Disposition header. Prefer the filename/size MediaFire's
  // own public page displayed, when the HEAD response didn't give us one.
  if (resolved.source === 'mediafire') {
    const headerFilename = extractFilenameFromHeader(response.headers['content-disposition']);
    if (!headerFilename && resolved.pageFilename) {
      meta.filename = resolved.pageFilename;
      meta.extension = getExtension(resolved.pageFilename);
    }
    if (meta.sizeBytes === null && resolved.pageSizeHuman) {
      meta.sizeHuman = resolved.pageSizeHuman;
    }
    meta.source = 'mediafire';
    meta.originalUrl = resolved.originalUrl;
  }

  return meta;
}

/**
 * Streams the remote file directly through to the Express
 * response object, forwarding the appropriate headers so the
 * browser downloads it with the correct filename and type.
 */
async function streamDownload(rawUrl, res) {
  const resolved = await resolveSourceUrl(rawUrl);
  const targetUrl = resolved.targetUrl;

  await assertSafeUrl(targetUrl);

  const requestConfig = {
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    responseType: 'stream',
    validateStatus: () => true,
    headers: { 'User-Agent': USER_AGENT },
    beforeRedirect: async (options) => {
      const target = `${options.protocol}//${options.hostname}${options.path}`;
      const check = await validateUrl(target);
      if (!check.valid) {
        throw new Error(`Redirect blocked: ${check.reason}`);
      }
    },
  };

  let response;
  try {
    response = await axios.get(targetUrl, requestConfig);
  } catch (err) {
    throw normalizeAxiosError(err);
  }

  if (response.status >= 400) {
    const err = new Error(
      `The remote server responded with status ${response.status}. The file may require authentication or may not be publicly accessible.`
    );
    err.statusCode = 502;
    throw err;
  }

  const contentLength = parseInt(response.headers['content-length'], 10);
  if (!isNaN(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    response.data.destroy();
    const err = new Error(
      `File exceeds the maximum allowed size of ${formatBytes(MAX_FILE_SIZE_BYTES)}.`
    );
    err.statusCode = 413;
    throw err;
  }

  const meta = buildMetadata(targetUrl, response);

  // Same MediaFire filename/size fallback as fetchFileInfo, kept in sync
  // so the downloaded file's name matches what the info card showed.
  if (resolved.source === 'mediafire') {
    const headerFilename = extractFilenameFromHeader(response.headers['content-disposition']);
    if (!headerFilename && resolved.pageFilename) {
      meta.filename = resolved.pageFilename;
      meta.extension = getExtension(resolved.pageFilename);
    }
  }

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${meta.filename.replace(/"/g, '')}"`
  );
  res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
  if (!isNaN(contentLength)) {
    res.setHeader('Content-Length', contentLength);
  }

  // Enforce the size cap even when Content-Length was absent/lied about,
  // by counting bytes as they stream through.
  let streamed = 0;
  response.data.on('data', (chunk) => {
    streamed += chunk.length;
    if (streamed > MAX_FILE_SIZE_BYTES) {
      response.data.destroy();
      res.destroy();
    }
  });

  response.data.on('error', (err) => {
    logger.error(`Stream error while downloading ${rawUrl}: ${err.message}`);
    if (!res.headersSent) {
      res.status(502);
    }
    res.end();
  });

  response.data.pipe(res);
}

/** Builds a normalized metadata object from an axios response. */
function buildMetadata(rawUrl, response) {
  const urlObj = new URL(rawUrl);
  const headerFilename = extractFilenameFromHeader(response.headers['content-disposition']);
  const rawFilename = headerFilename || extractFilenameFromUrl(urlObj);
  const filename = sanitizeFilename(rawFilename);
  const contentLength = parseInt(response.headers['content-length'], 10);

  return {
    filename,
    extension: getExtension(filename),
    contentType: response.headers['content-type'] || 'application/octet-stream',
    sizeBytes: isNaN(contentLength) ? null : contentLength,
    sizeHuman: isNaN(contentLength) ? 'Unknown' : formatBytes(contentLength),
    acceptsRanges: response.headers['accept-ranges'] === 'bytes',
    status: 'available',
    finalUrl: response.request?.res?.responseUrl || rawUrl,
  };
}

/** Converts assorted axios/network errors into user-friendly HTTP errors. */
function normalizeAxiosError(err) {
  if (err.statusCode) return err; // already normalized

  const wrapped = new Error(deriveMessage(err));
  wrapped.statusCode = deriveStatusCode(err);
  return wrapped;
}

function deriveMessage(err) {
  if (err.code === 'ECONNABORTED') return 'The request timed out while contacting the remote server.';
  if (err.code === 'ENOTFOUND') return 'The host could not be found (DNS resolution failed).';
  if (err.code === 'ECONNREFUSED') return 'The remote server refused the connection.';
  if (err.message?.startsWith('Redirect blocked')) return err.message;
  return 'Failed to reach the remote server. It may be offline or blocking automated requests.';
}

function deriveStatusCode(err) {
  if (err.code === 'ECONNABORTED') return 504;
  if (err.message?.startsWith('Redirect blocked')) return 400;
  return 502;
}

module.exports = { fetchFileInfo, streamDownload };
