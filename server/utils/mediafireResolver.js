/**
 * utils/mediafireResolver.js
 * ------------------------------------------------------------
 * Adds support for MediaFire "file" share links (e.g.
 * https://www.mediafire.com/file/<id>/<name>/file).
 *
 * MediaFire does not expose a public JSON API for anonymous
 * file metadata/download links, so the only legitimate way to
 * get the official CDN download URL is to load the same public
 * HTML page a browser would load and read the plain, static
 * download link that MediaFire already renders into that page
 * for anyone who is not logged in.
 *
 * SCOPE / ETHICS BOUNDARY — read before modifying:
 *  - We only ever issue a plain GET to the public page URL the
 *    user gave us. No login, no cookies, no session reuse.
 *  - We only extract a download link that is already present as
 *    a static `href` in the HTML. We never execute page
 *    JavaScript and never attempt to reverse-engineer or decode
 *    any obfuscated/scrambled token MediaFire may use to deter
 *    scraping. If a plain static link isn't present, we fail
 *    closed and tell the user to open the page manually.
 *  - If the page indicates the file is password-protected, we
 *    stop and report that — we do not attempt to guess, brute
 *    force, or prompt-inject a password.
 *  - If the page is a folder link, a removed-file page, or looks
 *    like a bot-protection / CAPTCHA challenge page, we stop and
 *    report that rather than working around it.
 * ------------------------------------------------------------
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { validateUrl } = require('./urlValidator');
const { sanitizeFilename, getExtension } = require('./fileHelpers');

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 15_000;
const USER_AGENT = 'UniversalFileDownloader/1.0 (+https://example.com)';

const MEDIAFIRE_HOSTNAMES = new Set(['mediafire.com', 'www.mediafire.com']);

/** True if the given URL points at a MediaFire page. */
function isMediaFireUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return MEDIAFIRE_HOSTNAMES.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** True if the URL is a MediaFire *folder* link, which we don't support. */
function isMediaFireFolderUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return /\/folder\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Fetches a MediaFire public file page and extracts:
 *  - the official direct CDN download URL (static href only)
 *  - the display filename
 *  - the human-readable file size shown on the page
 *
 * Throws a descriptive, statusCode-tagged error for every case
 * where the file is not a plain, publicly downloadable file.
 *
 * @param {string} pageUrl
 * @returns {Promise<{ directUrl: string, filename: string, sizeHuman: string|null }>}
 */
async function resolveMediaFireFile(pageUrl) {
  if (isMediaFireFolderUrl(pageUrl)) {
    const err = new Error(
      'MediaFire folder links are not supported — please provide a direct file link (mediafire.com/file/...).'
    );
    err.statusCode = 400;
    throw err;
  }

  // Defense in depth: re-validate against SSRF rules even though the
  // hostname is already constrained to mediafire.com.
  const check = await validateUrl(pageUrl);
  if (!check.valid) {
    const err = new Error(check.reason);
    err.statusCode = 400;
    throw err;
  }

  let response;
  try {
    response = await axios.get(pageUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      responseType: 'text',
    });
  } catch (err) {
    const wrapped = new Error('Could not reach MediaFire to load the file page.');
    wrapped.statusCode = 502;
    throw wrapped;
  }

  if (response.status === 404) {
    const err = new Error('MediaFire reports this file does not exist or was removed.');
    err.statusCode = 404;
    throw err;
  }
  if (response.status >= 400) {
    const err = new Error(`MediaFire returned status ${response.status} for this page.`);
    err.statusCode = 502;
    throw err;
  }

  const html = response.data;
  const $ = cheerio.load(html);

  // --- Detect a removed / invalid file page -------------------------------
  const bodyText = $('body').text();
  if (/could not be found|has been removed|no longer available/i.test(bodyText)) {
    const err = new Error('This MediaFire file has been removed or is no longer available.');
    err.statusCode = 404;
    throw err;
  }

  // --- Detect password protection -----------------------------------------
  const hasPasswordForm =
    $('form#form_password').length > 0 ||
    $('input[name="downloadp_password"]').length > 0 ||
    /this file is password protected/i.test(bodyText);
  if (hasPasswordForm) {
    const err = new Error(
      'This MediaFire file is password-protected. Password-protected files are not supported — please enter the password on mediafire.com and download it manually.'
    );
    err.statusCode = 403;
    throw err;
  }

  // --- Detect a bot-protection / interstitial challenge page --------------
  if (/captcha|checking your browser|access denied/i.test(bodyText) && !$('#downloadButton').length) {
    const err = new Error(
      'MediaFire presented a bot-protection challenge for this link. This cannot be bypassed — please open the link in a browser.'
    );
    err.statusCode = 403;
    throw err;
  }

  // --- Extract the official static download link ---------------------------
  // MediaFire renders the real CDN link directly into #downloadButton's
  // href for public, non-password files. We only accept it if it's a
  // plain absolute URL already sitting in the markup — no JS evaluation.
  let directUrl =
    $('a#downloadButton').attr('href') ||
    $('a.input.popsok').attr('href') ||
    null;

  if (!directUrl) {
    // Fallback: scan for any statically-present MediaFire CDN link.
    const cdnMatch = html.match(/https?:\/\/download[\w.-]*\.mediafire\.com\/[^\s"'<>]+/i);
    directUrl = cdnMatch ? cdnMatch[0] : null;
  }

  if (!directUrl || !/^https?:\/\//i.test(directUrl)) {
    const err = new Error(
      'Could not find a public direct download link on this MediaFire page. It may require sign-in or additional verification on mediafire.com.'
    );
    err.statusCode = 422;
    throw err;
  }

  // The resolved CDN link must also pass SSRF validation before we ever
  // request it — same rule every other URL in this app has to follow.
  const cdnCheck = await validateUrl(directUrl);
  if (!cdnCheck.valid) {
    const err = new Error(`Resolved MediaFire download link failed validation: ${cdnCheck.reason}`);
    err.statusCode = 400;
    throw err;
  }

  // --- Extract display filename ---------------------------------------------
  const rawName =
    $('.dl-btn-label').attr('title') ||
    $('.dl-btn-label').text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().replace(/\s*-\s*MediaFire\s*$/i, '').trim() ||
    'downloaded-file';
  const filename = sanitizeFilename(rawName);

  // --- Extract human-readable size, if present -------------------------------
  let sizeHuman = null;
  $('li, span, div').each((_, elNode) => {
    if (sizeHuman) return;
    const text = $(elNode).text().trim();
    const match = text.match(/^([\d.]+\s?(?:B|KB|MB|GB))$/i);
    if (match) sizeHuman = match[1];
  });

  return {
    directUrl,
    filename,
    extension: getExtension(filename),
    sizeHuman,
  };
}

module.exports = { isMediaFireUrl, isMediaFireFolderUrl, resolveMediaFireFile };
