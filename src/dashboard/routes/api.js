const express = require('express');
const { requireAuth } = require('../auth/requireAuth');
const { requireGuildAccess } = require('../auth/requireGuildAccess');

const { createStatsRouter } = require('./statsRoutes');
const { createGuildRoutes } = require('./guildRoutes');
const { createInviteRoutes } = require('./inviteRoutes');
const { createSafetyRoutes } = require('./safetyRoutes');
const { createSimulatorRoutes } = require('./simulatorRoutes');

/**
 * Aggregator router. Mounts feature routers; applies authentication and per-
 * guild authorization centrally. No business logic lives here.
 *
 *  /stats, /health           -> public telemetry
 *  /guilds                   -> authenticated, only manageable guilds
 *  /guilds/:guildId/**       -> authenticated + manageable by the session user
 */
function createApiRouter({ client, config, services }) {
  const router = express.Router();

  router.use(createStatsRouter({ client, guildGateway: services.guildGateway, config }));

  router.use('/guilds', createGuildRoutes({ guildService: services.guilds, guildAccess: services.guildAccess }));

  const guildScoped = [requireAuth, requireGuildAccess(services.guildAccess, { access: 'manage' })];

  router.use('/guilds/:guildId/invites', ...guildScoped, createInviteRoutes({ inviteService: services.invites }));
  router.use('/guilds/:guildId/safety', ...guildScoped, createSafetyRoutes({ safetyService: services.safety }));
  router.use('/guilds/:guildId/simulate', ...guildScoped, createSimulatorRoutes({ inviteService: services.invites, safetyService: services.safety }));

  return router;
}

module.exports = { createApiRouter };
