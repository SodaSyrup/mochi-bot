const express = require('express');
const { requireAuth } = require('../auth/requireAuth');
const { requireGuildAccess } = require('../auth/requireGuildAccess');

const { createStatsRouter } = require('./statsRoutes');
const { createGuildRoutes } = require('./guildRoutes');
const { createInviteRoutes } = require('./inviteRoutes');
const { createSafetyRoutes } = require('./safetyRoutes');
const { createHoneypotRoutes } = require('./honeypotRoutes');
const { createPluginRoutes } = require('./pluginRoutes');
const { requireGuildPlugin } = require('../auth/requireGuildPlugin');
const { PluginRegistrationError } = require('../../plugins/core/errors');

/**
 * Aggregator router. Mounts feature routers; applies authentication and per-
 * guild authorization centrally. No business logic lives here.
 *
 *  /stats, /health           -> public telemetry
 *  /guilds                   -> authenticated, only manageable guilds
 *  /guilds/:guildId/**       -> authenticated + manageable by the session user
 */
function createApiRouter({ client, config, services, contributions = null }) {
  const router = express.Router();

  router.use(createStatsRouter({ client, guildGateway: services.guildGateway, config }));

  router.use('/guilds', createGuildRoutes({
    guildService: services.guilds,
    guildAccess: services.guildAccess,
    inviteService: services.invites,
  }));

  const guildScoped = [requireAuth, requireGuildAccess(services.guildAccess, { access: 'manage' })];

  router.use('/guilds/:guildId/plugins', ...guildScoped, createPluginRoutes({
    pluginSettings: services.pluginSettings,
  }));

  const featureContributions = contributions?.getDashboardApiContributions?.() || [];
  if (contributions) {
    for (const contribution of featureContributions) {
      const target = express.Router({ mergeParams: true });
      try {
        contribution.install(target, {
          client,
          config,
          services,
          contribution,
        });
      } catch (error) {
        throw new PluginRegistrationError(`Dashboard API contribution "${contribution.id}" failed to install.`, {
          pluginId: contribution.pluginId,
          cause: error,
        });
      }
      const middleware = contribution.scope === 'public'
        ? []
        : contribution.scope === 'auth'
          ? [requireAuth]
          : [
            ...guildScoped,
            requireGuildPlugin(services.pluginSettings, contribution.pluginId),
          ];
      router.use(contribution.mountPath, ...middleware, target);
    }
  } else {
    // Compatibility path for direct consumers that construct this router
    // without a plugin registry.
    router.use('/guilds/:guildId/invites', ...guildScoped, createInviteRoutes({
      inviteService: services.invites,
      pagination: config.limits.pagination,
    }));
    router.use('/guilds/:guildId/safety', ...guildScoped, createSafetyRoutes({ safetyService: services.safety }));
    router.use('/guilds/:guildId/honeypot', ...guildScoped, createHoneypotRoutes({
      honeypotService: services.honeypot,
      guildService: services.guilds,
    }));
  }
  return router;
}

module.exports = { createApiRouter };
