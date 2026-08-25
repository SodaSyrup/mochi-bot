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
const { DiscordPermissionGroupGateway } = require('../platform/discord/discordPermissionGroupGateway');

const { GuildAccessService } = require('../dashboard/auth/guildAccessService');
const { GuildPermissionService } = require('../dashboard/auth/guildPermissionService');
const { DiscordOAuthClient } = require('../dashboard/auth/discordOAuthClient');
const { HoneypotRepository } = require('../features/honeypot/infrastructure/honeypotRepository');
const { HoneypotService } = require('../features/honeypot/honeypotService');
const { PluginGuildSettingsService } = require('../plugins/core/pluginGuildSettings');
const { PermissionGroupRepository } = require('../features/permissionGroups/infrastructure/permissionGroupRepository');
const { PermissionGroupService } = require('../features/permissionGroups/permissionGroupService');
const defaultPluginCatalog = require('../plugins/catalog');
const { GlobalBanRepository } = require('../features/globalBans/infrastructure/globalBanRepository');
const { CloudflareGlobalBanClient } = require('../features/globalBans/infrastructure/cloudflareGlobalBanClient');
const { CloudflareGlobalBanAdminClient } = require('../features/globalBans/infrastructure/cloudflareGlobalBanAdminClient');
const { GlobalBanSyncService } = require('../features/globalBans/application/globalBanSyncService');
const { GlobalBanService } = require('../features/globalBans/application/globalBanService');
const { GlobalBanRecommendationService } = require('../features/globalBans/application/globalBanRecommendationService');
const { DiscordGlobalBanGateway } = require('../platform/discord/discordGlobalBanGateway');

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
  const permissionGroupRepository = new PermissionGroupRepository(db);
  const globalBanRepository = new GlobalBanRepository(db);

  const guildGateway = gatewayOverrides.guild || new DiscordGuildGateway({ client, logger });
  const inviteGateway = gatewayOverrides.invite || new DiscordInviteGateway({ client, logger });
  const safetyGateway = gatewayOverrides.safety || new DiscordSafetyGateway({ client, logger });
  const inviteLogGateway = gatewayOverrides.inviteLog || new DiscordInviteLogGateway({ client, logger });
  const honeypotGateway = gatewayOverrides.honeypot || new DiscordHoneypotGateway({ client, logger });
  const permissionGroupGateway = gatewayOverrides.permissionGroups || new DiscordPermissionGroupGateway({ client, logger });
  const globalBanGateway = gatewayOverrides.globalBans || new DiscordGlobalBanGateway({ client, logger });
  const globalBanClient = gatewayOverrides.globalBansClient || new CloudflareGlobalBanClient({
    baseUrl: config.globalBans?.apiUrl,
    token: config.globalBans?.syncToken,
    timeoutMs: config.globalBans?.requestTimeoutMs,
    logger,
  });
  const globalBanAdminClient = gatewayOverrides.globalBansAdminClient || new CloudflareGlobalBanAdminClient({
    baseUrl: config.globalBans?.apiUrl,
    token: config.globalBans?.adminToken,
    timeoutMs: config.globalBans?.requestTimeoutMs,
    logger,
  });

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
  const permissionGroups = new PermissionGroupService({
    repository: permissionGroupRepository,
    gateway: permissionGroupGateway,
    logger,
  });
  let globalBanService;
  const globalBanSync = new GlobalBanSyncService({
    repository: globalBanRepository,
    client: globalBanClient,
    logger,
    intervalSeconds: config.globalBans?.syncIntervalSeconds,
    onEvent: async (result, event) => globalBanService?.onSyncEvent(result, event),
  });
  globalBanService = new GlobalBanService({
    repository: globalBanRepository,
    gateway: globalBanGateway,
    sync: globalBanSync,
    client,
    eventBus,
    logger,
    config,
  });
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

  const globalBanRecommendations = new GlobalBanRecommendationService({
    guildService: guilds,
    adminClient: globalBanAdminClient,
    logger,
  });

  return {
    guildRepository,
    inviteRepository,
    inviteLogRepository,
    honeypotRepository,
    permissionGroupRepository,
    globalBanRepository,
    guildGateway,
    inviteGateway,
    safetyGateway,
    inviteLogGateway,
    honeypotGateway,
    permissionGroupGateway,
    globalBanGateway,
    globalBanClient,
    globalBanAdminClient,
    globalBanRecommendations,
    guilds,
    invites,
    safety,
    inviteLogs,
    honeypot,
    permissionGroups,
    globalBanSync,
    globalBans: globalBanService,
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
