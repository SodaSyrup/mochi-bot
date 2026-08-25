const { UnauthorizedError, ForbiddenError } = require('../errors');

function isGlobalBanAdmin(user, config) {
  const id = String(user?.id || '');
  const allowlist = config?.globalBans?.adminUserIds || [];
  return Boolean(id && allowlist.includes(id) && config?.globalBans?.adminToken);
}

function requireGlobalBanAdmin(config) {
  return (req, res, next) => {
    if (!req.session?.user) return next(new UnauthorizedError());
    if (!isGlobalBanAdmin(req.session.user, config)) {
      return next(new ForbiddenError('You do not have permission to manage the global ban registry.'));
    }
    next();
  };
}

module.exports = { isGlobalBanAdmin, requireGlobalBanAdmin };
