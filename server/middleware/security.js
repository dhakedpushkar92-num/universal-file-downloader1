/**
 * middleware/security.js
 * ------------------------------------------------------------
 * Centralizes Helmet (security headers) and CORS configuration
 * so server.js stays clean and these policies live in one place.
 * ------------------------------------------------------------
 */

const helmet = require('helmet');
const cors = require('cors');
const logger = require('../utils/logger');

/** Helmet: sensible, strict security headers for a JSON API. */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });
}

/**
 * CORS: only allow origins explicitly whitelisted via the
 * ALLOWED_ORIGINS environment variable (comma-separated).
 * Falls back to allowing all origins only in development.
 */
function corsPolicy() {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      // Allow non-browser tools (curl, server-to-server) with no Origin header.
      if (!origin) return callback(null, true);

      if (process.env.NODE_ENV !== 'production' || allowedOrigins.length === 0) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      logger.warn(`Blocked CORS request from disallowed origin: ${origin}`);
      return callback(new Error('Not allowed by CORS policy'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
    maxAge: 86400,
  });
}

module.exports = { securityHeaders, corsPolicy };
