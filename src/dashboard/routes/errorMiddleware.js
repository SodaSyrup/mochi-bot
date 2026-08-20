const { AppError } = require('../errors');

/**
 * Translate application errors into predictable JSON. Stack traces and OAuth
 * secrets are never exposed to clients.
 */
function apiErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }

  console.error('[API] Unhandled error:', err);
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Internal server error.' },
  });
}

/**
 * JSON 404 for unknown /api routes (MPA pages handle their own 404 HTML).
 */
function apiNotFound(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}

module.exports = { apiErrorHandler, apiNotFound };
