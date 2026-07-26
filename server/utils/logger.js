/**
 * utils/logger.js
 * ------------------------------------------------------------
 * Centralized Winston logger used across the entire backend.
 * Logs to console (always) and to rotating files in production.
 * ------------------------------------------------------------
 */

const winston = require('winston');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Human-readable log line format: [time] LEVEL: message
const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `[${ts}] ${level}: ${stack || message}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
  ],
  exitOnError: false,
});

// In production, also persist logs to disk for debugging/audit purposes.
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
  );
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

module.exports = logger;
