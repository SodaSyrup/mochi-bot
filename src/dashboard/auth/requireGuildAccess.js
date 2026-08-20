const { ValidationError, UnauthorizedError, ForbiddenError } = require('../errors');

/**
 * Require the authenticated user to be authorized for the guild in the URL.
 *
 * @param {import('./guildAccessService').GuildAccessService} guildAccess
 * @param {{ access?: 'view'|'manage', guildParam?: string }} options
 */
function requireGuildAccess(guildAccess, { access = 'manage', guildParam = 'guildId' } = {}) {
  return async (req, res, next) => {
    const guildId = req.params[guildParam];
    if (!guildId) return next(new ValidationError('Missing guild id.'));

    const user = req.session?.user;
    if (!user) return next(new UnauthorizedError());

    try {
      const allowed = access === 'view'
        ? await guildAccess.canViewGuild(user, guildId)
        : await guildAccess.canManageGuild(user, guildId);
      if (!allowed) throw new ForbiddenError('You do not have permission to access this guild.');
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireGuildAccess };
