/**
 * middleware/rateLimiter.js
 * ------------------------------------------------------------
 * Protects the API from abuse (and from being used as an open
 * SSRF/proxy tool) by capping requests per IP within a time
 * window. Values are configurable via environment variables.
 * ------------------------------------------------------------
 */

const rateLimit = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;
const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 30;

const apiRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true, // return rate limit info in RateLimit-* headers
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down and try again shortly.',
  },
});

module.exports = { apiRateLimiter };
