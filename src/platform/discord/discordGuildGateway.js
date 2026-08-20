const { ChannelType } = require('discord.js');

/**
 * Feature-oriented gateway for guild-level reads (listing, channels, roles).
 * Translates Discord.js guild objects into plain DTOs.
 */
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
      isSimulated: false,
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
      isSimulated: false,
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
}

module.exports = { DiscordGuildGateway };
