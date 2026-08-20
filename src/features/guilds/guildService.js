const { NotFoundError } = require('../../dashboard/errors');

/**
 * Guild feature service. Owns guild settings persistence (repository) and
 * guild listing/channel/role reads (gateway).
 */
class GuildService {
  constructor({ guildRepository, guildGateway }) {
    this.guilds = guildRepository;
    this.gateway = guildGateway;
  }

  async getGuild(guildId) {
    const discordGuild = await this.gateway.getGuild(guildId);
    const settings = this.guilds.getGuild(
      guildId,
      discordGuild ? discordGuild.name : 'Unknown Server',
      discordGuild ? discordGuild.icon : null
    );
    return {
      guild: {
        id: settings.guild_id,
        name: settings.name,
        icon: settings.icon,
        memberCount: discordGuild ? discordGuild.memberCount : 0,
      },
      settings,
    };
  }

  updateSettings(guildId, { fake_threshold_days }) {
    const updated = this.guilds.updateGuild(guildId, {
      fake_threshold_days: fake_threshold_days !== undefined ? parseInt(fake_threshold_days, 10) : undefined,
    });
    return updated;
  }

  async listChannels(guildId) {
    const channels = await this.gateway.fetchChannels(guildId);
    if (!channels) {
      throw new NotFoundError('No channels available for this guild.');
    }
    return channels;
  }

  async listRoles(guildId) {
    const roles = await this.gateway.fetchRoles(guildId);
    if (!roles) {
      throw new NotFoundError('No roles available for this guild.');
    }
    return roles;
  }
}

module.exports = { GuildService };
