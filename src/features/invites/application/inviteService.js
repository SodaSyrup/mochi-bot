const { AttributionType } = require('../domain/attribution');
const { createInvitePolicy } = require('../domain/invitePolicy');
const { resolveAttribution } = require('./inviteAttributionService');
const { GuildSerialQueue } = require('./guildSerialQueue');
const { InviteEvents } = require('../../../app/eventBus');

/**
 * Application service for the invites feature.
 *
 * Owns the join/leave attribution pipeline (serialized per guild), delegates
 * all persistence to the repository, applies policy via the shared invite
 * policy, and publishes canonical application events after successful
 * transitions. It knows nothing about the dashboard, Socket.IO or HTTP.
 */
class InviteService {
  constructor({ inviteRepository, guildRepository, inviteGateway, policy, eventBus, logger }) {
    this.invites = inviteRepository;
    this.guilds = guildRepository;
    this.gateway = inviteGateway;
    this.policy = policy || createInvitePolicy();
    this.eventBus = eventBus;
    this.logger = logger || console;

    this.queue = new GuildSerialQueue();
    // Operational caches (rebuildable from Discord; NOT durable truth).
    this.invitesCache = new Map(); // guildId -> Map<code, snapshot>
    this.vanityCache = new Map(); // guildId -> number|null
    this.memberInfo = new Map(); // guildId -> Map<userId, {username, avatar}>
  }

  #log(feature, operation, message, context) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger[context?.level === 'error' ? 'error' : 'info'](feature, operation, message, context);
    } else if (this.logger && typeof this.logger.log === 'function') {
      this.logger.log(`[${feature}] (${operation}) ${message}`);
    }
  }

  #cacheMemberInfo(guildId, memberData) {
    if (!guildId || !memberData?.id) return;
    if (!this.memberInfo.has(guildId)) this.memberInfo.set(guildId, new Map());
    this.memberInfo.get(guildId).set(memberData.id, {
      id: memberData.id,
      username: memberData.username || null,
      avatar: memberData.avatar || null,
    });
  }

  #getMemberInfo(guildId, userId) {
    return this.memberInfo.get(guildId)?.get(userId) || null;
  }

  #attributionToInviterPayload(attribution) {
    if (!attribution || attribution.type !== AttributionType.INVITE || !attribution.inviterId) {
      return null;
    }
    return { id: attribution.inviterId, username: null, avatar: null };
  }

  // ------------------------------------------------------------ lifecycle

  /**
   * Prime the invite cache for a guild and sync pre-existing members.
   * Called once per guild after the bot connects.
   */
  async initializeGuild(guildId) {
    await this.queue.run(guildId, async () => {
      const snapshot = await this.gateway.fetchGuildInvites(guildId);
      if (snapshot) {
        this.#storeSnapshot(guildId, snapshot);
      }
    });
    await this.syncPreExistingMembers(guildId);
  }

  #storeSnapshot(guildId, snapshot) {
    const map = new Map();
    for (const inv of snapshot.invites) map.set(inv.code, inv);
    this.invitesCache.set(guildId, map);
    this.vanityCache.set(guildId, snapshot.vanityUses ?? null);
    this.invites.saveCachedInvites(guildId, Array.from(map.values()));
  }

  /**
   * Historical sync of pre-existing members. Reuses the same policy as live
   * joins. Backfilled members are attributed PRE_EXISTING and never earn
   * inviter credit. Idempotent: running twice adds no new lifecycle records.
   */
  async syncPreExistingMembers(guildId) {
    const members = await this.gateway.fetchGuildMembers(guildId);
    if (!members) {
      return { available: false, synced: 0 };
    }

    const settings = this.guilds.getGuild(guildId);
    const list = [];
    for (const member of members) {
      if (!this.policy.shouldTrackMember(member)) continue;
      const isFake = this.policy.isSuspiciousAccount({
        accountCreatedAt: member.accountCreatedAt,
        joinedAt: member.joinedAt,
        fakeThresholdDays: settings.fake_threshold_days,
      });
      list.push({ userId: member.id, joinedAt: member.joinedAt, isFake });
      this.#cacheMemberInfo(guildId, member);
    }

    const synced = this.invites.syncPreExistingMembers(guildId, list);
    return { available: true, synced };
  }

  /**
   * Process a member join. `attributionOverride` is provided by simulated
   * inputs; live joins resolve attribution conservatively from invite deltas.
   */
  async trackMemberJoin(memberData, attributionOverride = null) {
    return this.queue.run(memberData.guildId, async () => {
      this.#cacheMemberInfo(memberData.guildId, memberData);
      const settings = this.guilds.getGuild(memberData.guildId);

      let attribution = attributionOverride;
      if (!attribution) {
        const previous = this.invitesCache.get(memberData.guildId);
        const previousVanity = this.vanityCache.get(memberData.guildId);
        let snapshot = null;
        try {
          snapshot = await this.gateway.fetchGuildInvites(memberData.guildId);
        } catch (err) {
          this.#log('invites', 'trackJoin', `Invite fetch threw for guild ${memberData.guildId}; attribution UNKNOWN`, {
            guildId: memberData.guildId,
            userId: memberData.id,
            error: err,
          });
        }

        if (!snapshot) {
          // Could not fetch invite state — record an explicit UNKNOWN rather
          // than guessing an inviter. The join itself is still processed.
          this.#log('invites', 'trackJoin', `Invite fetch failed for guild ${memberData.guildId}; attribution UNKNOWN`, {
            guildId: memberData.guildId,
            userId: memberData.id,
          });
          attribution = { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null };
        } else {
          attribution = resolveAttribution({
            previous: previous ? Array.from(previous.values()) : [],
            current: snapshot.invites,
            previousVanityUses: previousVanity,
            currentVanityUses: snapshot.vanityUses,
          });
          this.#storeSnapshot(memberData.guildId, snapshot);
        }
      }

      const isFake = this.policy.isSuspiciousAccount({
        accountCreatedAt: memberData.accountCreatedAt,
        joinedAt: memberData.joinedAt,
        fakeThresholdDays: settings.fake_threshold_days,
      });

      const result = this.invites.trackJoin({
        guildId: memberData.guildId,
        userId: memberData.id,
        attribution,
        isFake,
        joinedAt: memberData.joinedAt,
      });

      if (attribution.type === AttributionType.UNKNOWN) {
        this.#log('invites', 'trackJoin', 'Invite attribution ambiguous', { guildId: memberData.guildId, userId: memberData.id });
      }

      if (result.applied) {
        const inviterStats = attribution.inviterId
          ? this.invites.getInviter(memberData.guildId, attribution.inviterId)
          : null;
        const inviterInfo = attribution.inviterId
          ? (await this.gateway.resolveUser(attribution.inviterId)) || { id: attribution.inviterId }
          : null;

        this.eventBus.emit(InviteEvents.MemberJoined, {
          guildId: memberData.guildId,
          member: {
            id: memberData.id,
            username: memberData.username || `User_${memberData.id.slice(-4)}`,
            avatar: memberData.avatar || null,
          },
          attribution: {
            type: attribution.type,
            inviterId: attribution.inviterId,
            inviteCode: attribution.inviteCode,
          },
          inviter: inviterInfo,
          isFake,
          inviterStats,
          occurredAt: new Date().toISOString(),
        });

        return {
          result,
          attribution,
          isFake,
          inviterStats: attribution.inviterId
            ? this.invites.getInviter(memberData.guildId, attribution.inviterId)
            : null,
        };
      }

      if (result.reason === 'DUPLICATE_JOIN') {
        this.#log('invites', 'trackJoin', 'Duplicate member join ignored', { guildId: memberData.guildId, userId: memberData.id });
      }

      return { result, attribution, isFake, inviterStats: null };
    });
  }

  async trackMemberLeave(memberData) {
    return this.queue.run(memberData.guildId, async () => {
      const result = this.invites.trackLeave({
        guildId: memberData.guildId,
        userId: memberData.id,
        leftAt: memberData.leftAt,
      });

      if (result.applied) {
        const member = this.invites.getCurrentMember(memberData.guildId, memberData.id) || {};
        const attribution = {
          type: member.attribution_type || AttributionType.UNKNOWN,
          inviterId: member.inviter_id ?? null,
          inviteCode: member.invite_code ?? null,
        };
        const memberInfo = this.#getMemberInfo(memberData.guildId, memberData.id) || {
          username: memberData.username || `User_${memberData.id.slice(-4)}`,
          avatar: memberData.avatar || null,
        };
        const inviterStats = attribution.inviterId
          ? this.invites.getInviter(memberData.guildId, attribution.inviterId)
          : null;
        const inviterInfo = attribution.inviterId
          ? (await this.gateway.resolveUser(attribution.inviterId)) || { id: attribution.inviterId }
          : null;

        this.eventBus.emit(InviteEvents.MemberLeft, {
          guildId: memberData.guildId,
          member: { id: memberData.id, username: memberInfo.username, avatar: memberInfo.avatar },
          attribution,
          inviter: inviterInfo,
          inviterStats,
          occurredAt: new Date().toISOString(),
        });
      }

      return { result };
    });
  }

  handleInviteCreated(inviteData) {
    const { guildId, code, uses, maxUses, inviterId, channelId, channelName, createdAt } = inviteData;
    if (!guildId || !code) return;
    const cache = this.invitesCache.get(guildId) || new Map();
    cache.set(code, {
      code,
      uses: uses || 0,
      inviterId: inviterId || null,
      maxUses: maxUses || 0,
      channelId: channelId || null,
      channelName: channelName || null,
      createdAt: createdAt || new Date().toISOString(),
    });
    this.invitesCache.set(guildId, cache);
  }

  handleInviteDeleted(inviteData) {
    const { guildId, code } = inviteData;
    if (!guildId || !code) return;
    this.invitesCache.get(guildId)?.delete(code);
  }

  /**
   * Drop in-memory caches when the bot leaves a guild. Operational state only.
   */
  forgetGuild(guildId) {
    this.invitesCache.delete(guildId);
    this.vanityCache.delete(guildId);
    this.memberInfo.delete(guildId);
  }

  // ------------------------------------------------------- invite management

  async createInvite({ guildId, channelId, maxAge, maxUses, temporary, label, reason }) {
    const created = await this.gateway.createInvite({ guildId, channelId, maxAge, maxUses, temporary, reason });
    const trimmedLabel = label && label.trim() ? label.trim() : null;

    let saved = null;
    if (trimmedLabel) {
      saved = this.invites.setInviteLabel(guildId, created.code, trimmedLabel, created.channelId, created.channelName);
    }
    this.invites.saveCachedInvite(guildId, {
      code: created.code,
      uses: created.uses,
      maxUses: created.maxUses,
      inviterId: created.inviterId,
      channelId: created.channelId,
      channelName: created.channelName,
      createdAt: created.createdAt,
    });

    const inviteDto = {
      code: created.code,
      url: `https://discord.gg/${created.code}`,
      uses: created.uses || 0,
      maxUses: created.maxUses || 0,
      maxAge: created.maxAge || 0,
      temporary: Boolean(created.temporary),
      channelId: created.channelId,
      channelName: created.channelName,
      inviter: { id: created.inviterId, username: null },
      createdAt: created.createdAt || new Date().toISOString(),
      label: trimmedLabel || null,
    };

    this.eventBus.emit(InviteEvents.InviteCreated, { guildId, invite: inviteDto, occurredAt: new Date().toISOString() });
    return inviteDto;
  }

  async deleteInvite(guildId, code) {
    await this.gateway.deleteInvite(guildId, code);
    this.invites.deleteCachedInvite(guildId, code);
    this.invites.deleteInviteLabel(guildId, code);
    this.invitesCache.get(guildId)?.delete(code);
    this.eventBus.emit(InviteEvents.InviteDeleted, { guildId, code, occurredAt: new Date().toISOString() });
    return { code };
  }

  setInviteLabel({ guildId, code, label, channelId, channelName }) {
    if (!label || !label.trim()) {
      return this.removeInviteLabel(guildId, code);
    }
    const saved = this.invites.setInviteLabel(guildId, code, label.trim(), channelId, channelName);
    const payload = {
      guildId,
      code,
      label: saved?.label || null,
      channelId: saved?.channel_id || null,
      channelName: saved?.channel_name || null,
      occurredAt: new Date().toISOString(),
    };
    this.eventBus.emit(InviteEvents.LabelUpdated, payload);
    return payload;
  }

  removeInviteLabel(guildId, code) {
    this.invites.deleteInviteLabel(guildId, code);
    const payload = { guildId, code, label: null, channelId: null, channelName: null, occurredAt: new Date().toISOString() };
    this.eventBus.emit(InviteEvents.LabelUpdated, payload);
    return payload;
  }

  /**
   * Active invites: prefer a fresh Discord snapshot, fall back to the
   * database cache.
   *
   * An empty fresh snapshot is authoritative — Discord successfully reported
   * zero active invites, so any stale cached entries are cleared. Only a
   * FAILED fetch (null/exception from the gateway) may fall back to the
   * persisted cache.
   */
  async getActiveInvites(guildId) {
    const labels = this.invites.getInviteLabels(guildId);
    const labelByCode = new Map(labels.map((l) => [l.code, l]));

    let rows;
    try {
      const snapshot = await this.gateway.fetchGuildInvites(guildId);
      if (snapshot) {
        // A fresh snapshot — even an EMPTY one — is authoritative and replaces
        // the persisted cache. Only a failed fetch may fall back below.
        this.#storeSnapshot(guildId, snapshot);
        rows = snapshot.invites;
      } else {
        rows = this.invites.getCachedInvites(guildId);
      }
    } catch (err) {
      // Gateway unavailable: fall back to the last-known persisted cache.
      this.#log('invites', 'getActiveInvites', `Invite fetch failed for guild ${guildId}; using cached invites`, {
        guildId,
        error: err,
      });
      rows = this.invites.getCachedInvites(guildId);
    }

    const result = [];
    for (const inv of rows) {
      const labelData = labelByCode.get(inv.code);
      const inviter = inv.inviterId ? await this.gateway.resolveUser(inv.inviterId) : null;
      result.push({
        code: inv.code,
        url: `https://discord.gg/${inv.code}`,
        uses: inv.uses || 0,
        maxUses: inv.maxUses || 0,
        maxAge: inv.maxAge || 0,
        temporary: Boolean(inv.temporary),
        channelId: inv.channelId || labelData?.channel_id || null,
        channelName: inv.channelName || labelData?.channel_name || null,
        inviter: inviter || { id: inv.inviterId || null, username: inv.inviterId ? `User_${inv.inviterId.slice(-4)}` : null },
        createdAt: inv.createdAt || null,
        expiresAt: inv.expiresAt || null,
        label: labelData ? labelData.label : null,
      });
    }
    return result;
  }

  // ------------------------------------------------------------- queries

  getInviterStats(guildId, userId) {
    return this.invites.getInviter(guildId, userId);
  }

  getCurrentMember(guildId, userId) {
    return this.invites.getCurrentMember(guildId, userId);
  }

  getLeaderboard(guildId, options) {
    return this.invites.getLeaderboard(guildId, options);
  }

  async getLeaderboardWithUsers(guildId, { limit = 10, offset = 0 } = {}) {
    const total = this.invites.getInvitersCount(guildId);
    const rows = this.invites.getLeaderboard(guildId, { limit, offset });
    const leaderboard = [];
    for (const row of rows) {
      const user = await this.gateway.resolveUser(row.userId);
      leaderboard.push({
        ...row,
        username: user?.username || `User_${row.userId.slice(-4)}`,
        avatar: user?.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
      });
    }
    const page = Math.floor(offset / limit) + 1;
    return {
      leaderboard,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getRecentJoinsWithUsers(guildId, limit = 10) {
    const rows = this.invites.getRecentJoins(guildId, limit);
    const result = [];
    for (const j of rows) {
      const user = await this.gateway.resolveUser(j.userId);
      const inviter = j.attribution.inviterId ? await this.gateway.resolveUser(j.attribution.inviterId) : null;
      result.push({
        user_id: j.userId,
        username: user?.username || `User_${j.userId.slice(-4)}`,
        avatar: user?.avatar || `https://cdn.discordapp.com/embed/avatars/${this.#avatarIndex(j.userId)}.png`,
        inviter_id: j.attribution.inviterId,
        inviterName: this.#inviterLabel(j.attribution, inviter),
        invite_code: j.attribution.inviteCode || null,
        invite_label: j.inviteLabel || null,
        channel_name: j.channelName || null,
        joined_at: j.joinedAt,
        left_at: j.leftAt,
        is_fake: j.isFake,
        is_left: j.isLeft,
      });
    }
    return result;
  }

  async getActivityLogWithUsers(guildId, options) {
    const data = this.invites.getActivityLog(guildId, options);
    const items = [];
    for (const item of data.items) {
      const user = await this.gateway.resolveUser(item.userId);
      const inviter = item.attribution.inviterId ? await this.gateway.resolveUser(item.attribution.inviterId) : null;
      const isPreExisting = item.isPreExisting;

      let eventType = item.eventType;
      if (item.eventType === 'JOIN' && item.isFake) eventType = 'FAKE_JOIN';
      if (isPreExisting && item.eventType === 'JOIN') eventType = 'PRE_BOT';

      items.push({
        userId: item.userId,
        username: user?.username || (item.userId.startsWith('mem_') ? `Member_${item.userId.slice(-4)}` : `User_${item.userId.slice(-4)}`),
        avatar: user?.avatar || `https://cdn.discordapp.com/embed/avatars/${this.#avatarIndex(item.userId)}.png`,
        attribution: {
          type: item.attribution.type,
          inviterId: item.attribution.inviterId,
          inviteCode: item.attribution.inviteCode,
        },
        inviterId: item.attribution.inviterId,
        inviterName: this.#inviterLabel(item.attribution, inviter),
        inviterAvatar: inviter?.avatar || `https://cdn.discordapp.com/embed/avatars/${this.#avatarIndex(item.attribution.inviterId || item.userId)}.png`,
        inviteCode: item.attribution.inviteCode || 'direct',
        inviteLabel: item.inviteLabel || null,
        channelName: item.channelName || null,
        joinedAt: item.joinedAt,
        leftAt: item.leftAt,
        isFake: item.isFake,
        isLeft: item.isLeft,
        isPreExisting,
        eventType,
      });
    }
    return { items, total: data.total, limit: data.limit, offset: data.offset, summary: data.summary };
  }

  #avatarIndex(id) {
    if (!id) return 0;
    return Math.abs(String(id).split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 5;
  }

  #inviterLabel(attribution, inviterUser) {
    if (attribution.type === AttributionType.VANITY) return 'Vanity URL';
    if (attribution.type === AttributionType.PRE_EXISTING) return 'Pre-Bot (Unknown)';
    if (attribution.type === AttributionType.UNKNOWN || !attribution.inviterId) return 'Unknown / Direct';
    return inviterUser?.username || `User_${String(attribution.inviterId).slice(-4)}`;
  }

  getInvitersCount(guildId) {
    return this.invites.getInvitersCount(guildId);
  }

  getRecentJoins(guildId, limit) {
    return this.invites.getRecentJoins(guildId, limit);
  }

  getActivityLog(guildId, options) {
    return this.invites.getActivityLog(guildId, options);
  }

  getDailyStats(guildId, days) {
    return this.invites.getDailyStats(guildId, days);
  }

  getInviteLabels(guildId) {
    return this.invites.getInviteLabels(guildId);
  }

  rebuildGuildProjections(guildId) {
    return this.invites.rebuildGuildProjections(guildId);
  }
}

module.exports = { InviteService };
