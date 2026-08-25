const { PermissionFlagsBits } = require('discord.js');

class DiscordGlobalBanGateway {
  constructor({ client, logger = console }) {
    this.client = client;
    this.logger = logger || console;
  }

  guild(guildId) {
    return this.client?.guilds?.cache?.get(guildId) || null;
  }

  async getPermissionStatus(guildId, channelId = null) {
    const guild = this.guild(guildId);
    const me = guild?.members?.me;
    const channel = channelId ? guild?.channels?.cache?.get(channelId) : null;
    const permissions = channel?.permissionsFor?.(me);
    return {
      guildAvailable: Boolean(guild),
      banMembers: Boolean(me?.permissions?.has(PermissionFlagsBits.BanMembers)),
      logChannelAvailable: !channelId || Boolean(channel),
      logChannelSendMessages: !channelId || Boolean(permissions?.has(PermissionFlagsBits.SendMessages)),
      logChannelEmbedLinks: !channelId || Boolean(permissions?.has(PermissionFlagsBits.EmbedLinks)),
    };
  }

  async isBanned(guildId, userId) {
    const guild = this.guild(guildId);
    if (!guild?.bans?.fetch) return null;
    try {
      await guild.bans.fetch(userId);
      return true;
    } catch (error) {
      if (error?.code === 10026 || error?.status === 404) return false;
      throw error;
    }
  }

  async banUser({ guildId, userId, reason, deleteMessageSeconds = 0 }) {
    const guild = this.guild(guildId);
    if (!guild?.members?.ban) return { outcome: 'guild_unavailable' };
    const permissions = await this.getPermissionStatus(guildId);
    if (!permissions.banMembers) return { outcome: 'missing_permission' };
    const existing = await this.isBanned(guildId, userId);
    if (existing === true) return { outcome: 'already_banned' };
    await guild.members.ban(userId, {
      deleteMessageSeconds: Math.max(0, Math.min(Number(deleteMessageSeconds) || 0, 7 * 24 * 60 * 60)),
      reason: String(reason || 'Mochi global protection').slice(0, 512),
    });
    return { outcome: 'banned' };
  }

  async sendAlert({ guildId, channelId, userId, username, reason, outcome = 'listed' }) {
    const guild = this.guild(guildId);
    const channel = channelId ? guild?.channels?.cache?.get(channelId) : null;
    if (!channel?.isTextBased?.() || !channel.send) return { outcome: 'log_channel_unavailable' };
    const content = [
      `Global protection alert: ${username || userId} (${userId})`,
      `Status: ${outcome}`,
      reason ? `Reason: ${reason}` : null,
    ].filter(Boolean).join('\n');
    await channel.send({ content, allowedMentions: { parse: [] } });
    return { outcome: 'alerted' };
  }
}

module.exports = { DiscordGlobalBanGateway };
