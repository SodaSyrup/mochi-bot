const { NotFoundError, ValidationError } = require('../../dashboard/errors');

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

  /**
   * Persist guild settings.
   *
   * invite_log_channel_id semantics:
   *   undefined        -> leave the current value untouched
   *   null / ''        -> disable invite logging (stores NULL)
   *   non-empty id     -> must belong to this guild, otherwise ValidationError
   *
   * @returns {Promise<object>} the updated guild row
   */
  async updateSettings(guildId, { fake_threshold_days, invite_log_channel_id }) {
    let normalizedChannelId;
    if (invite_log_channel_id !== undefined) {
      const trimmed = invite_log_channel_id == null ? '' : String(invite_log_channel_id).trim();
      normalizedChannelId = trimmed === '' ? null : trimmed;
      if (normalizedChannelId !== null) {
        const channels = await this.gateway.fetchChannels(guildId);
        const belongs = Array.isArray(channels) && channels.some((c) => c.id === normalizedChannelId);
        if (!belongs) {
          throw new ValidationError('Invite log channel must belong to this guild.');
        }
      }
    }

    let normalizedThreshold;
    if (fake_threshold_days !== undefined) {
      normalizedThreshold = Number(fake_threshold_days);
      if (!Number.isInteger(normalizedThreshold) || normalizedThreshold < 0 || normalizedThreshold > 365) {
        throw new ValidationError('fake_threshold_days must be an integer between 0 and 365.');
      }
    }

    const updated = this.guilds.updateGuild(guildId, {
      fake_threshold_days: normalizedThreshold,
      invite_log_channel_id: normalizedChannelId,
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
