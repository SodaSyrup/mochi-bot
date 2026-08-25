const crypto = require('crypto');
const { ForbiddenError } = require('../errors');

function getCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function requireCsrf(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(config.dashboard.url).origin) {
          return next(new ForbiddenError('Cross-origin requests are not allowed.'));
        }
      } catch {
        return next(new ForbiddenError('Invalid request origin.'));
      }
    }
    const supplied = Buffer.from(String(req.get('x-csrf-token') || ''));
    const expected = Buffer.from(String(req.session?.csrfToken || ''));
    if (!expected.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return next(new ForbiddenError('A valid CSRF token is required.'));
    }
    next();
  };
}

module.exports = { getCsrfToken, requireCsrf };
