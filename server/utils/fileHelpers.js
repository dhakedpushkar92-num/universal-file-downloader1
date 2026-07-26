/**
 * utils/fileHelpers.js
 * ------------------------------------------------------------
 * Small pure helper functions for deriving file metadata
 * (name, extension, human-readable size) from HTTP responses.
 * ------------------------------------------------------------
 */

const path = require('path');

/**
 * Extracts a filename from a Content-Disposition header, if present.
 * Supports both `filename="x.png"` and RFC 5987 `filename*=UTF-8''x.png`.
 */
function extractFilenameFromHeader(contentDisposition) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      /* fall through */
    }
  }

  const basicMatch = contentDisposition.match(/filename="?([^"; ]+)"?/i);
  if (basicMatch && basicMatch[1]) {
    return basicMatch[1].trim();
  }

  return null;
}

/**
 * Derives a best-effort filename from the URL path itself,
 * falling back to a generic name if nothing usable is found.
 */
function extractFilenameFromUrl(urlObj) {
  const pathname = decodeURIComponent(urlObj.pathname || '');
  const base = path.basename(pathname);
  return base && base !== '/' && base !== '' ? base : 'downloaded-file';
}

/**
 * Sanitizes a filename to strip directory traversal characters
 * and anything unsafe for use in a Content-Disposition header
 * or a local filesystem.
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[/\\]/g, '_') // no path separators
    .replace(/\.\./g, '_') // no directory traversal
    .replace(/[\x00-\x1f<>:"|?*]/g, '') // strip control/reserved chars
    .slice(0, 255) // filesystem-safe length
    .trim() || 'downloaded-file';
}

/** Returns the lowercase extension (without the dot), or empty string. */
function getExtension(filename) {
  const ext = path.extname(filename || '');
  return ext.startsWith('.') ? ext.slice(1).toLowerCase() : '';
}

/** Converts a byte count into a human-readable string (e.g. "12.4 MB"). */
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

module.exports = {
  extractFilenameFromHeader,
  extractFilenameFromUrl,
  sanitizeFilename,
  getExtension,
  formatBytes,
};
