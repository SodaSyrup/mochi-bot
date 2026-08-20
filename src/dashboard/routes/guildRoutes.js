const express = require('express');
const { requireAuth } = require('../auth/requireAuth');
const { requireGuildAccess } = require('../auth/requireGuildAccess');

/**
 * Guild routes — require authentication and per-guild authorization.
 * The guild listing is the one route that consults GuildAccessService so only
 * manageable guilds (where Mochi is present) are ever shown.
 */
function createGuildRoutes({ guildService, guildAccess }) {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    const guilds = await guildAccess.listManageableGuilds(req.session);
    res.json({ guilds });
  });

  router.use('/:guildId', requireAuth, requireGuildAccess(guildAccess, { access: 'manage' }));

  router.get('/:guildId', async (req, res) => {
    const result = await guildService.getGuild(req.params.guildId);
    res.json(result);
  });

  router.patch('/:guildId/settings', async (req, res) => {
    const updated = guildService.updateSettings(req.params.guildId, {
      fake_threshold_days: req.body?.fake_threshold_days,
    });
    res.json({ success: true, settings: updated });
  });

  router.get('/:guildId/channels', async (req, res) => {
    const channels = await guildService.listChannels(req.params.guildId);
    res.json({ channels });
  });

  router.get('/:guildId/roles', async (req, res) => {
    const roles = await guildService.listRoles(req.params.guildId);
    res.json({ roles });
  });

  return router;
}

module.exports = { createGuildRoutes };
