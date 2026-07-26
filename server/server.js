/**
 * server.js
 * ------------------------------------------------------------
 * Application entry point. Wires together middleware, routes,
 * and error handling, then starts the HTTP server.
 * ------------------------------------------------------------
 */

require('dotenv').config();

const express = require('express');
const morgan = require('morgan');

const { securityHeaders, corsPolicy } = require('./middleware/security');
const routes = require('./routes/downloadRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust the first proxy hop (required on Render/Railway/Vercel-style
// platforms for correct client IPs, used by the rate limiter).
app.set('trust proxy', 1);

// --- Global middleware -------------------------------------------------
app.use(securityHeaders());
app.use(corsPolicy());
app.use(express.json({ limit: '10kb' })); // request bodies are tiny (just a URL)
app.use(
  morgan('combined', {
    stream: { write: (message) => logger.http(message.trim()) },
  })
);

// --- Routes --------------------------------------------------------------
app.use('/', routes);

// --- 404 handler -----------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// --- Centralized error handler --------------------------------------------
// Catches anything thrown synchronously in middleware (e.g. CORS rejection).
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  if (res.headersSent) return next(err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || 'Internal server error.',
  });
});

app.listen(PORT, () => {
  logger.info(`Universal File Downloader API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// --- Process-level safety nets ---------------------------------------------
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
});
