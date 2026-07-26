/**
 * routes/downloadRoutes.js
 * ------------------------------------------------------------
 * Defines all API routes and wires them to their controllers.
 * ------------------------------------------------------------
 */

const express = require('express');
const { getFileInfo, downloadFile } = require('../controllers/downloadController');
const { apiRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// GET /health — lightweight liveness/readiness probe for hosting platforms.
router.get('/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok', uptimeSeconds: process.uptime() });
});

// POST /info — fetch metadata about a remote file without downloading it.
router.post('/info', apiRateLimiter, getFileInfo);

// POST /download — stream the remote file back to the client.
router.post('/download', apiRateLimiter, downloadFile);

module.exports = router;
