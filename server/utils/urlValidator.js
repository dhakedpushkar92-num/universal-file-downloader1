/**
 * utils/urlValidator.js
 * ------------------------------------------------------------
 * Validates user-supplied URLs before the server ever makes a
 * request to them. This is the app's primary line of defense
 * against SSRF (Server-Side Request Forgery), because the
 * backend performs outbound HTTP requests on the user's behalf.
 *
 * Rules enforced:
 *  - Must be a syntactically valid absolute URL
 *  - Protocol must be http: or https:
 *  - Hostname must not resolve to a private / loopback /
 *    link-local / reserved IP address (blocks localhost,
 *    127.0.0.1, 10.x, 172.16-31.x, 192.168.x, 169.254.x,
 *    ::1, fc00::/7, etc.)
 *  - Hostname must not be a "metadata service" address used by
 *    cloud providers (e.g. 169.254.169.254)
 *  - No credentials embedded in the URL (user:pass@host)
 * ------------------------------------------------------------
 */

const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

// Explicit denylist of hostnames that should never be reachable,
// even if DNS resolution is somehow bypassed downstream.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
]);

/**
 * Returns true if the given IP address string is within a private,
 * loopback, link-local, or otherwise non-public range.
 */
function isPrivateOrReservedIp(ip) {
  try {
    const addr = ipaddr.parse(ip);
    const range = addr.range();
    // ipaddr.js classifies addresses into ranges such as:
    // 'unicast', 'private', 'loopback', 'linkLocal', 'uniqueLocal',
    // 'reserved', 'carrierGradeNat', 'broadcast', etc.
    // Only a plain public "unicast" range is allowed.
    return range !== 'unicast';
  } catch (err) {
    // If we can't parse it, treat it as unsafe.
    return true;
  }
}

/**
 * Performs full validation of a candidate URL string.
 * Resolves DNS to catch "DNS rebinding" attempts where a public
 * hostname resolves to a private IP.
 *
 * @param {string} rawUrl
 * @returns {Promise<{ valid: boolean, reason?: string, url?: URL }>}
 */
async function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'URL is required.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return { valid: false, reason: 'The provided string is not a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      valid: false,
      reason: `Unsupported protocol "${parsed.protocol}". Only http and https are allowed.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      reason: 'URLs containing embedded credentials are not allowed.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: 'Requests to this host are not permitted.' };
  }

  // If the hostname is already a literal IP address, validate it directly.
  if (ipaddr.isValid(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        valid: false,
        reason: 'Requests to private or reserved IP addresses are not permitted.',
      };
    }
    return { valid: true, url: parsed };
  }

  // Otherwise resolve DNS and check every returned address.
  // This blocks DNS-rebinding attacks against internal infrastructure.
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      return { valid: false, reason: 'Could not resolve hostname.' };
    }
    const unsafe = records.some((r) => isPrivateOrReservedIp(r.address));
    if (unsafe) {
      return {
        valid: false,
        reason: 'This hostname resolves to a private or reserved network address.',
      };
    }
  } catch (err) {
    return { valid: false, reason: 'Could not resolve hostname.' };
  }

  return { valid: true, url: parsed };
}

module.exports = { validateUrl, isPrivateOrReservedIp };
