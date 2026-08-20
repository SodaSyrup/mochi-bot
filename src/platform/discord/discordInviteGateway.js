const { ChannelType } = require('discord.js');

/**
 * Feature-oriented adapter between Discord.js invite objects and the invite
 * application service. All Discord.js collections are translated into plain
 * application DTOs here so the domain layer never touches Discord primitives.
 */
class DiscordInviteGateway {
  constructor({ client, logger }) {
    this.client = client;
    this.logger = logger;
  }

  #guild(guildId) {
    return this.client?.guilds?.cache?.get(guildId) || null;
  }

  #canManage(guild) {
    return Boolean(guild && guild.members?.me?.permissions?.has('ManageGuild'));
  }

  toInviteSnapshot(invite) {
    return {
      code: invite.code,
      uses: invite.uses || 0,
      inviterId: invite.inviter?.id || null,
      maxUses: invite.maxUses || 0,
      maxAge: invite.maxAge || 0,
      temporary: Boolean(invite.temporary),
      channelId: invite.channel?.id || null,
      channelName: invite.channel?.name || null,
      createdAt: invite.createdAt ? new Date(invite.createdAt).toISOString() : null,
      expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : null,
    };
  }

  /**
   * Fetch all invites plus vanity usage for a guild.
   * @returns {Promise<{ invites: Array, vanityUses: number|null }|null>} null
   *   when the snapshot cannot be fetched (e.g. missing permission).
   */
  async fetchGuildInvites(guildId) {
    const guild = this.#guild(guildId);
    if (!guild) return null;

    let invites = [];
    if (this.#canManage(guild)) {
      try {
        const fetched = await guild.invites.fetch();
        invites = fetched.map((inv) => this.toInviteSnapshot(inv));
      } catch (err) {
        this.logger?.error('invites', 'fetchGuildInvites', `Failed to fetch invites for guild ${guildId}`, { guildId, error: err });
        return null;
      }
    }

    let vanityUses = null;
    if (guild.features?.includes('VANITY_URL') && guild.fetchVanityData) {
      try {
        const vanity = await guild.fetchVanityData();
        vanityUses = vanity?.uses ?? 0;
      } catch (err) {
        this.logger?.warn('invites', 'fetchVanity', `Could not fetch vanity usage for guild ${guildId}`, { guildId, error: err });
        vanityUses = null;
      }
    }

    return { invites, vanityUses };
  }

  async fetchGuildMembers(guildId) {
    const guild = this.#guild(guildId);
    if (!guild) return null;

    let members;
    try {
      members = await guild.members.fetch();
    } catch {
      members = guild.members.cache;
    }
    if (!members || members.size === 0) return [];

    return members.map((member) => ({
      id: member.id,
      guildId,
      username: member.user?.username || null,
      avatar: member.user?.displayAvatarURL?.({ dynamic: true }) || null,
      bot: Boolean(member.user?.bot),
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      accountCreatedAt: member.user?.createdAt ? member.user.createdAt.toISOString() : null,
    }));
  }

  async createInvite({ guildId, channelId, maxAge = 0, maxUses = 0, temporary = false, reason }) {
    const guild = this.#guild(guildId);
    if (!guild) {
      throw new Error('Bot is not in this guild.');
    }
    if (!guild.members?.me?.permissions?.has('CreateInstantInvite')) {
      throw new Error('Bot lacks Create Instant Invite permission.');
    }

    let channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (!channel) {
      channel = guild.channels.cache.find(
        (c) => c.isTextBased?.() || [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)
      );
    }
    if (!channel || typeof channel.createInvite !== 'function') {
      throw new Error('No valid text channel available for invite creation.');
    }

    const inv = await channel.createInvite({
      maxAge: parseInt(maxAge, 10) || 0,
      maxUses: parseInt(maxUses, 10) || 0,
      temporary: Boolean(temporary),
      unique: true,
      reason: reason || 'Created via Mochi Dashboard',
    });

    const snapshot = this.toInviteSnapshot(inv);
    return { ...snapshot, channelId: channel.id, channelName: channel.name };
  }

  async deleteInvite(guildId, code) {
    const guild = this.#guild(guildId);
    if (!guild) throw new Error('Bot is not in this guild.');
    if (!this.#canManage(guild)) throw new Error('Bot lacks Manage Guild permission.');

    const fetched = await guild.invites.fetch();
    const inv = fetched.get(code);
    if (inv) {
      await inv.delete('Revoked via Mochi Dashboard');
    }
    return { code };
  }

  async resolveUser(userId) {
    if (!userId) return null;
    const cached = this.client?.users?.cache?.get(userId);
    if (cached) return { id: cached.id, username: cached.username, avatar: cached.displayAvatarURL?.() || null };
    try {
      const u = await this.client?.users?.fetch(userId);
      if (u) return { id: u.id, username: u.username, avatar: u.displayAvatarURL?.() || null };
    } catch {
      return null;
    }
    return null;
  }
}

module.exports = { DiscordInviteGateway };
