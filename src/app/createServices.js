const { GuildRepository } = require('../features/guilds/infrastructure/guildRepository');
const { InviteRepository } = require('../features/invites/infrastructure/inviteRepository');
const { InviteService } = require('../features/invites/application/inviteService');
const { createInvitePolicy } = require('../features/invites/domain/invitePolicy');
const { GuildService } = require('../features/guilds/guildService');
const { SafetyService } = require('../features/safety/safetyService');

const { DiscordInviteGateway } = require('../platform/discord/discordInviteGateway');
const { DiscordGuildGateway } = require('../platform/discord/discordGuildGateway');
const { DiscordSafetyGateway } = require('../platform/discord/discordSafetyGateway');

const { DemoInviteGateway } = require('../demo/demoInviteGateway');
const { DemoGuildGateway } = require('../demo/demoGuildGateway');
const { DemoSafetyGateway } = require('../demo/demoSafetyGateway');

const { GuildAccessService } = require('../dashboard/auth/guildAccessService');
const { GuildPermissionService } = require('../dashboard/auth/guildPermissionService');
const { DiscordOAuthClient } = require('../dashboard/auth/discordOAuthClient');

/**
 * Compose all application services from a config + database + (optional)
 * Discord client. Demo vs live gateway selection happens EXACTLY here, once.
 * Nothing else in the application decides whether to simulate.
 */
function createServices({ config, db, eventBus, client, logger }) {
  const guildRepository = new GuildRepository(db);
  const inviteRepository = new InviteRepository(db);

  let guildGateway;
  let inviteGateway;
  let safetyGateway;

  if (config.app.isDemo) {
    guildGateway = new DemoGuildGateway();
    inviteGateway = new DemoInviteGateway();
    safetyGateway = new DemoSafetyGateway();
  } else {
    guildGateway = new DiscordGuildGateway({ client, logger });
    inviteGateway = new DiscordInviteGateway({ client, logger });
    safetyGateway = new DiscordSafetyGateway({ client, logger });
  }

  const policy = createInvitePolicy();

  const guilds = new GuildService({ guildRepository, guildGateway });
  const invites = new InviteService({
    inviteRepository,
    guildRepository,
    inviteGateway,
    policy,
    eventBus,
    logger,
  });
  const safety = new SafetyService({ safetyGateway, eventBus, logger });

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
    isDemo: config.app.isDemo,
    isDevelopment: config.app.isDevelopment,
  });

  return {
    guildRepository,
    inviteRepository,
    guildGateway,
    inviteGateway,
    safetyGateway,
    guilds,
    invites,
    safety,
    policy,
    guildAccess,
    guildPermissionService,
    oauthClient,
    eventBus,
    logger,
  };
}

module.exports = { createServices };
