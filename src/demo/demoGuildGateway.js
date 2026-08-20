const { DEMO_GUILD_ID, DEMO_GUILD, DEMO_CHANNELS, DEMO_ROLES } = require('./fixtures');

/**
 * Demo guild gateway — provides guild/channel/role listings for the dashboard
 * in demo mode. Only ever selected for APP_MODE=demo.
 */
class DemoGuildGateway {
  constructor() {
    this.safetySettings = {
      guildId: DEMO_GUILD_ID,
      guildName: DEMO_GUILD.name,
      verificationLevel: 1,
      explicitContentFilter: 1,
      defaultMessageNotifications: 1,
      mfaLevel: 0,
      safetyAlertsChannelId: 'chan_announcements',
      rulesChannelId: 'chan_welcome',
      features: [...DEMO_GUILD.features],
      isSimulated: true,
    };
  }

  async listGuilds() {
    return [{ ...DEMO_GUILD }];
  }

  async getGuild(guildId) {
    return guildId === DEMO_GUILD_ID ? { ...DEMO_GUILD } : null;
  }

  async fetchChannels(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    return DEMO_CHANNELS.map((c) => ({ ...c }));
  }

  async fetchRoles(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    return DEMO_ROLES.map((r) => ({ ...r }));
  }

  get isDemo() {
    return true;
  }
}

module.exports = { DemoGuildGateway };
