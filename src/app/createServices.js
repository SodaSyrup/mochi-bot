const { GuildRepository } = require('../features/guilds/infrastructure/guildRepository');
const { InviteRepository } = require('../features/invites/infrastructure/inviteRepository');
const { InviteService } = require('../features/invites/application/inviteService');
const { createInvitePolicy } = require('../features/invites/domain/invitePolicy');
const { GuildService } = require('../features/guilds/guildService');
const { SafetyService } = require('../features/safety/safetyService');
const { InviteLogRepository } = require('../features/inviteLogs/infrastructure/inviteLogRepository');
const { InviteLogService } = require('../features/inviteLogs/application/inviteLogService');

const { DiscordInviteGateway } = require('../platform/discord/discordInviteGateway');
const { DiscordGuildGateway } = require('../platform/discord/discordGuildGateway');
const { DiscordSafetyGateway } = require('../platform/discord/discordSafetyGateway');
const { DiscordInviteLogGateway } = require('../platform/discord/discordInviteLogGateway');
const { DiscordHoneypotGateway } = require('../platform/discord/discordHoneypotGateway');

const { GuildAccessService } = require('../dashboard/auth/guildAccessService');
const { GuildPermissionService } = require('../dashboard/auth/guildPermissionService');
const { DiscordOAuthClient } = require('../dashboard/auth/discordOAuthClient');
const { HoneypotRepository } = require('../features/honeypot/infrastructure/honeypotRepository');
const { HoneypotService } = require('../features/honeypot/honeypotService');
const { PluginGuildSettingsService } = require('../plugins/core/pluginGuildSettings');
const defaultPluginCatalog = require('../plugins/catalog');

/**
 * Compose all application services from a config + database + Discord client.
 */
function createServices({ config, db, eventBus, client, logger, gatewayOverrides = {}, pluginCatalog = defaultPluginCatalog }) {
  const guildRepository = new GuildRepository(db, {
    defaultFakeThresholdDays: config.inviteTracker.fakeAccountThresholdDays,
  });
  const inviteRepository = new InviteRepository(db);
  const inviteLogRepository = new InviteLogRepository(db);
  const honeypotRepository = new HoneypotRepository(db);

  const guildGateway = gatewayOverrides.guild || new DiscordGuildGateway({ client, logger });
  const inviteGateway = gatewayOverrides.invite || new DiscordInviteGateway({ client, logger });
  const safetyGateway = gatewayOverrides.safety || new DiscordSafetyGateway({ client, logger });
  const inviteLogGateway = gatewayOverrides.inviteLog || new DiscordInviteLogGateway({ client, logger });
  const honeypotGateway = gatewayOverrides.honeypot || new DiscordHoneypotGateway({ client, logger });

  const policy = createInvitePolicy({
    defaultFakeThresholdDays: config.inviteTracker.fakeAccountThresholdDays,
  });

  const guilds = new GuildService({
    guildRepository,
    guildGateway,
    maxFakeThresholdDays: config.inviteTracker.maxFakeAccountThresholdDays,
  });
  const invites = new InviteService({
    inviteRepository,
    guildRepository,
    inviteGateway,
    policy,
    eventBus,
    logger,
    limits: config.limits,
  });
  const safety = new SafetyService({ safetyGateway, eventBus, logger });
  const inviteLogs = new InviteLogService({
    guildRepository,
    inviteLogRepository,
    inviteLogGateway,
    eventBus,
    logger,
    subscribe: !config.plugins?.disabled?.includes('invite-logs'),
  });
  const honeypot = new HoneypotService({ honeypotRepository, honeypotGateway, eventBus, logger });
  const pluginSettings = new PluginGuildSettingsService({
    db,
    plugins: pluginCatalog,
    globallyDisabled: config.plugins?.disabled || [],
    logger,
  });
  inviteLogs.pluginSettings = pluginSettings;

  const oauthClient = new DiscordOAuthClient({
    clientId: config.bot.clientId,
    clientSecret: config.bot.clientSecret,
    redirectUri: config.dashboard.redirectUri,
    logger,
  });

  const guildPermissionService = new GuildPermissionService({
    oauthClient,
    ttlSeconds: config.auth.permissionTtlSeconds,
    logger,
  });

  const guildAccess = new GuildAccessService({
    guildGateway,
    permissionService: guildPermissionService,
    isDevelopment: config.app.isDevelopment,
  });

  return {
    guildRepository,
    inviteRepository,
    inviteLogRepository,
    honeypotRepository,
    guildGateway,
    inviteGateway,
    safetyGateway,
    inviteLogGateway,
    honeypotGateway,
    guilds,
    invites,
    safety,
    inviteLogs,
    honeypot,
    pluginSettings,
    policy,
    guildAccess,
    guildPermissionService,
    oauthClient,
    eventBus,
    logger,
  };
}

module.exports = { createServices };
