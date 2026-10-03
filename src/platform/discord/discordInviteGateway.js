const { ChannelType, AuditLogEvent } = require('discord.js');
const { DEFAULTS } = require('../../config/defaults');

/** Converts Discord invite objects to the DTOs used by the invite service. */
class DiscordInviteGateway {
  constructor({ client, logger }) {
    this.client = client;
    this.logger = logger;
    this.memberFetches = new Map();
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
   *   when the snapshot cannot be fetched. For example, the bot may lack a
   *   required permission.
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
    } else {
      // An empty list here would be interpreted as an authoritative snapshot
      // and erase the last known attribution/display cache. Missing Manage
      // Guild permission means normal invite data is unavailable.
      return null;
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

    return { invites, vanityUses, vanityUnavailable: Boolean(guild.features?.includes('VANITY_URL') && vanityUses == null) };
  }

  /** Return revoked codes, or null if the recent audit window is incomplete. */
  async fetchRecentInviteDeletions(guildId, since) {
    const guild = this.#guild(guildId);
    if (!guild?.members?.me?.permissions?.has('ViewAuditLog')) return null;
    try {
      const after = ((BigInt(Math.floor(since)) - 1420070400000n) << 22n).toString();
      const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.InviteDelete, after, limit: 100 });
      if (!audit?.entries || audit.entries.size >= 100) return null;
      const codes = [];
      for (const entry of audit.entries.values()) {
        const change = entry.changes?.find((item) => item.key === 'code');
        const code = change?.old ?? change?.new ?? entry.target?.code;
        // An unidentified revocation may be the link under consideration.
        if (!code) return null;
        codes.push(code);
      }
      return codes;
    } catch (error) {
      this.logger?.error('invites', 'fetchInviteDeletions', `Failed to check invite deletions for guild ${guildId}`, { guildId, error });
      return null;
    }
  }

  async fetchGuildMembers(guildId) {
    const pending = this.memberFetches.get(guildId);
    if (pending) return pending;
    const request = this.#fetchGuildMembers(guildId);
    this.memberFetches.set(guildId, request);
    try {
      return await request;
    } finally {
      if (this.memberFetches.get(guildId) === request) this.memberFetches.delete(guildId);
    }
  }

  async #fetchGuildMembers(guildId) {
    const guild = this.#guild(guildId);
    if (!guild) return null;

    let members;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        members = await guild.members.fetch();
        break;
      } catch (error) {
        const retrySeconds = Number(error?.data?.retry_after);
        if (error?.name === 'GatewayRateLimitError' && Number.isFinite(retrySeconds) && retrySeconds >= 0 && retrySeconds <= 30 && attempt < 2) {
          this.logger?.warn('members', 'fetchGuildMembers', 'Discord rate-limited the member list. Waiting before retrying.', { guildId, retrySeconds });
          await new Promise((resolve) => setTimeout(resolve, Math.ceil(retrySeconds * 1000) + 100));
          continue;
        }
        this.logger?.error('members', 'fetchGuildMembers', `Failed to fetch authoritative members for guild ${guildId}`, { guildId, error });
        return null;
      }
    }
    if (!members || members.size === 0) return [];

    return members.map((member) => ({
      id: member.id,
      guildId,
      username: member.user?.username || null,
      legacyUsername: member.user?.discriminator && member.user.discriminator !== '0' ? `${member.user.username}#${member.user.discriminator}` : null,
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
      reason: reason || 'Created through Mochi Dashboard',
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
      await inv.delete('Revoked through Mochi Dashboard');
    }
    return { code };
  }

  async resolveUser(userId) {
    if (!userId) return null;
    const cached = this.client?.users?.cache?.get(userId);
    if (cached) return { id: cached.id, username: cached.username, avatar: cached.displayAvatarURL?.() || null, bot: Boolean(cached.bot), accountCreatedAt: cached.createdAt?.toISOString() || null };
    try {
      const u = await this.client?.users?.fetch(userId);
      if (u) return { id: u.id, username: u.username, avatar: u.displayAvatarURL?.() || null, bot: Boolean(u.bot), accountCreatedAt: u.createdAt?.toISOString() || null };
    } catch {
      return null;
    }
    return null;
  }

  async resolveUsers(userIds, { concurrency = DEFAULTS.operations.userResolveConcurrency, onProgress = () => {} } = {}) {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    const result = new Map();
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        result.set(id, await this.resolveUser(id));
        onProgress(result.size, ids.length);
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () => worker());
    await Promise.all(workers);
    return result;
  }
}

module.exports = { DiscordInviteGateway };
