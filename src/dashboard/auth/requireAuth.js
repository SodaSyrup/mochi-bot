const { UnauthorizedError } = require('../errors');

/**
 * Require a valid authenticated session. JSON 401 otherwise.
 */
function requireAuth(req, res, next) {
  if (req.session?.user) {
    return next();
  }
  next(new UnauthorizedError());
}

module.exports = { requireAuth };
