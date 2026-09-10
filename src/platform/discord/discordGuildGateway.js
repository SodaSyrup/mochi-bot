const { ChannelType, PermissionFlagsBits } = require('discord.js');

/** Converts Discord guild data into dashboard DTOs. */
class DiscordGuildGateway {
  constructor({ client, logger }) {
    this.client = client;
    this.logger = logger;
  }

  async listGuilds() {
    const cache = this.client?.guilds?.cache;
    if (!cache) return [];
    return Array.from(cache.values(), (g) => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL?.({ dynamic: true }) || null,
      memberCount: g.memberCount || 0,
      ownerId: g.ownerId || null,
    }));
  }

  async getGuild(guildId) {
    const g = this.client?.guilds?.cache?.get(guildId);
    if (!g) return null;
    return {
      id: g.id,
      name: g.name,
      icon: g.iconURL?.({ dynamic: true }) || null,
      memberCount: g.memberCount || 0,
      ownerId: g.ownerId || null,
    };
  }

  async fetchChannels(guildId) {
    const g = this.client?.guilds?.cache?.get(guildId);
    if (!g?.channels) return null;
    const channels = Array.from(g.channels.cache.values())
      .filter((c) => c.isTextBased?.() || [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement].includes(c.type))
      .map((c) => ({ id: c.id, name: c.name, type: c.type, position: c.position || 0 }))
      .sort((a, b) => a.position - b.position);
    return channels.length > 0 ? channels : null;
  }

  async fetchRoles(guildId) {
    const g = this.client?.guilds?.cache?.get(guildId);
    if (!g?.roles) return null;
    const roles = Array.from(g.roles.cache.values())
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor !== '#000000' ? r.hexColor : '#99aab5',
        position: r.position,
        managed: r.managed,
      }))
      .sort((a, b) => b.position - a.position);
    return roles.length > 0 ? roles : null;
  }

  async fetchBans(guildId, { after = null, limit = 25 } = {}) {
    const guild = this.client?.guilds?.cache?.get(guildId);
    if (!guild?.bans?.fetch) return null;
    const me = guild.members?.me;
    if (me?.permissions?.has && !me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return { status: 'permission_denied', bans: [], nextCursor: null, hasMore: false };
    }
    const boundedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const collection = await guild.bans.fetch({
      limit: boundedLimit,
      ...(after ? { after: String(after) } : {}),
      cache: false,
    });
    const bans = Array.from(collection.values()).map((ban) => ({
      userId: ban.user?.id,
      username: ban.user?.username || null,
      globalName: ban.user?.globalName || null,
      avatarUrl: ban.user?.displayAvatarURL?.({ dynamic: true }) || null,
      reason: ban.reason || null,
    })).filter((ban) => ban.userId);
    return {
      status: 'ok',
      bans,
      nextCursor: bans.length === boundedLimit ? bans.at(-1)?.userId || null : null,
      hasMore: bans.length === boundedLimit,
    };
  }
}

module.exports = { DiscordGuildGateway };
