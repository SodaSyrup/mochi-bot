const { NotFoundError } = require('../errors');

/** Hide a feature route when its plugin is disabled for the requested guild. */
function requireGuildPlugin(pluginSettings, pluginId, { guildParam = 'guildId' } = {}) {
  return (req, res, next) => {
    const guildId = req.params[guildParam];
    if (!guildId) return next(new NotFoundError('Guild not found.'));
    if (!pluginSettings?.isEnabled(guildId, pluginId)) {
      return next(new NotFoundError('This feature is disabled for this guild.'));
    }
    return next();
  };
}

module.exports = { requireGuildPlugin };
