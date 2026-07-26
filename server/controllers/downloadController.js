/**
 * controllers/downloadController.js
 * ------------------------------------------------------------
 * Thin HTTP layer: parses/validates the incoming request body,
 * delegates to downloadService, and formats the response.
 * All heavy lifting lives in the service layer.
 * ------------------------------------------------------------
 */

const { fetchFileInfo, streamDownload } = require('../services/downloadService');
const logger = require('../utils/logger');

/**
 * POST /info
 * Body: { url: string }
 * Returns file metadata (name, extension, size, type) without
 * downloading the file body.
 */
async function getFileInfo(req, res) {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'A "url" field is required.' });
  }

  try {
    const meta = await fetchFileInfo(url);
    logger.info(`Info fetched for ${url} -> ${meta.filename} (${meta.sizeHuman})`);
    return res.status(200).json({ success: true, data: meta });
  } catch (err) {
    logger.warn(`Info request failed for ${url}: ${err.message}`);
    return res
      .status(err.statusCode || 500)
      .json({ success: false, error: err.message || 'Failed to fetch file information.' });
  }
}

/**
 * POST /download
 * Body: { url: string }
 * Streams the remote file back to the client as an attachment.
 */
async function downloadFile(req, res) {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'A "url" field is required.' });
  }

  try {
    logger.info(`Download started for ${url}`);
    await streamDownload(url, res);
  } catch (err) {
    logger.warn(`Download failed for ${url}: ${err.message}`);
    if (!res.headersSent) {
      return res
        .status(err.statusCode || 500)
        .json({ success: false, error: err.message || 'Failed to download file.' });
    }
    // Headers already sent (streaming in progress) — just end the response.
    res.end();
  }
}

module.exports = { getFileInfo, downloadFile };
