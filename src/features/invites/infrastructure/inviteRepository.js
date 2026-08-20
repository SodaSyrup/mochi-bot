const { AttributionType } = require('../domain/attribution');
const { rebuildGuildInviteProjections } = require('./projectionRebuilder');

const DAILY_COLUMNS = ['joins', 'leaves', 'fakes'];

/**
 * Owns invite persistence only. Business rules (policy, attribution, queueing)
 * live in application/domain layers and feed plain DTOs into this repository.
 *
 * All state transitions (join/leave) are transactional so the lifecycle event,
 * current member projection, inviter projection and daily projection can never
 * be left half-applied.
 *
 * The lifecycle ledger (invite_events) is the durable source of truth;
 * invite_members and inviters are projections of it.
 */
class InviteRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------------------------------------------------------------- helpers

  #getMember(guildId, userId) {
    return this.db
      .prepare(`
        SELECT guild_id, user_id, inviter_id, invite_code, joined_at, is_fake,
               is_left, left_at, membership_cycle, attribution_type
        FROM invite_members
        WHERE guild_id = ? AND user_id = ?
      `)
      .get(guildId, userId);
  }

  #insertEvent({ guildId, userId, cycle, eventType, attribution, isFake, occurredAt }) {
    this.db
      .prepare(`
        INSERT INTO invite_events
          (guild_id, user_id, membership_cycle, event_type, attribution_type,
           inviter_id, invite_code, is_fake, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        guildId,
        userId,
        cycle,
        eventType,
        attribution.type,
        attribution.inviterId ?? null,
        attribution.inviteCode ?? null,
        isFake ? 1 : 0,
        occurredAt || new Date().toISOString()
      );
  }

  #upsertMember({ guildId, userId, cycle, attribution, isFake, joinedAt }) {
    this.db
      .prepare(`
        INSERT INTO invite_members
          (guild_id, user_id, inviter_id, invite_code, joined_at, is_fake,
           is_left, left_at, membership_cycle, attribution_type)
        VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      `)
      .run(
        guildId,
        userId,
        attribution.inviterId ?? null,
        attribution.inviteCode ?? null,
        joinedAt || new Date().toISOString(),
        isFake ? 1 : 0,
        cycle,
        attribution.type
      );
  }

  #updateMemberPresent({ guildId, userId, cycle, attribution, isFake, joinedAt }) {
    this.db
      .prepare(`
        UPDATE invite_members
        SET inviter_id = ?, invite_code = ?, joined_at = ?, is_fake = ?,
            is_left = 0, left_at = NULL, membership_cycle = ?, attribution_type = ?
        WHERE guild_id = ? AND user_id = ?
      `)
      .run(
        attribution.inviterId ?? null,
        attribution.inviteCode ?? null,
        joinedAt || new Date().toISOString(),
        isFake ? 1 : 0,
        cycle,
        attribution.type,
        guildId,
        userId
      );
  }

  #markMemberLeft({ guildId, userId, leftAt }) {
    this.db
      .prepare(`
        UPDATE invite_members
        SET is_left = 1, left_at = ?
        WHERE guild_id = ? AND user_id = ?
      `)
      .run(leftAt || new Date().toISOString(), guildId, userId);
  }

  #ensureInviter(guildId, userId) {
    this.db
      .prepare(`
        INSERT INTO inviters (guild_id, user_id, regular, bonus, leaves, fake, updated_at)
        VALUES (?, ?, 0, 0, 0, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id, user_id) DO NOTHING
      `)
      .run(guildId, userId);
  }

  // A fake INVITE join contributes regular +1 AND fake +1 (zero net credit).
  #applyJoinToInviter(guildId, memberId, attribution, isFake) {
    if (attribution.type !== AttributionType.INVITE) return;
    if (!attribution.inviterId || attribution.inviterId === memberId) return;
    this.#ensureInviter(guildId, attribution.inviterId);
    this.db
      .prepare(`
        UPDATE inviters
        SET regular = regular + 1, fake = fake + ?, updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = ? AND user_id = ?
      `)
      .run(isFake ? 1 : 0, guildId, attribution.inviterId);
  }

  // Leaves only remove credit that was actually earned: a member excluded by
  // the fake counter must not also subtract a net invite via `leaves`.
  #applyLeaveToInviter(guildId, memberId, attribution, isFake) {
    if (attribution.type !== AttributionType.INVITE) return;
    if (!attribution.inviterId || attribution.inviterId === memberId) return;
    if (isFake) return;
    this.#ensureInviter(guildId, attribution.inviterId);
    this.db
      .prepare(`
        UPDATE inviters
        SET leaves = leaves + 1, updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = ? AND user_id = ?
      `)
      .run(guildId, attribution.inviterId);
  }

  #recordDailyStat(guildId, occurredAt, column) {
    if (!DAILY_COLUMNS.includes(column)) return;
    const date = String(occurredAt || new Date().toISOString()).slice(0, 10);
    this.db
      .prepare(`
        INSERT INTO daily_invite_stats (guild_id, date, joins, leaves, fakes)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, date) DO UPDATE SET
          ${column} = ${column} + 1
      `)
      .run(
        guildId,
        date,
        column === 'joins' ? 1 : 0,
        column === 'leaves' ? 1 : 0,
        column === 'fakes' ? 1 : 0
      );
  }

  // ----------------------------------------------------------- join / leave

  /**
   * Idempotent join state machine.
   *
   *  - no member record       -> cycle 1 JOIN, applied
   *  - already present        -> DUPLICATE_JOIN (no event, no counters)
   *  - previously left        -> rejoin: cycle + 1 JOIN, applied
   */
  trackJoin({ guildId, userId, attribution, isFake = false, joinedAt = null }) {
    const tx = this.db.transaction(() => {
      const member = this.#getMember(guildId, userId);

      if (!member) {
        const cycle = 1;
        this.#insertEvent({ guildId, userId, cycle, eventType: 'JOIN', attribution, isFake, occurredAt: joinedAt });
        this.#upsertMember({ guildId, userId, cycle, attribution, isFake, joinedAt });
        this.#applyJoinToInviter(guildId, userId, attribution, isFake);
        this.#recordDailyStat(guildId, joinedAt, isFake ? 'fakes' : 'joins');
        return { applied: true, reason: 'CREATED', cycle };
      }

      if (member.is_left === 0) {
        return { applied: false, reason: 'DUPLICATE_JOIN', cycle: member.membership_cycle };
      }

      const cycle = member.membership_cycle + 1;
      this.#insertEvent({ guildId, userId, cycle, eventType: 'JOIN', attribution, isFake, occurredAt: joinedAt });
      this.#updateMemberPresent({ guildId, userId, cycle, attribution, isFake, joinedAt });
      this.#applyJoinToInviter(guildId, userId, attribution, isFake);
      this.#recordDailyStat(guildId, joinedAt, isFake ? 'fakes' : 'joins');
      return { applied: true, reason: 'REJOINED', cycle };
    });
    return tx();
  }

  /**
   * Idempotent leave state machine.
   *
   *  - no member record       -> UNKNOWN_MEMBER (no changes)
   *  - already left           -> DUPLICATE_LEAVE (no event, no counters)
   *  - present member         -> LEAVE for current cycle, applied
   */
  trackLeave({ guildId, userId, leftAt = null }) {
    const tx = this.db.transaction(() => {
      const member = this.#getMember(guildId, userId);

      if (!member) {
        return { applied: false, reason: 'UNKNOWN_MEMBER' };
      }
      if (member.is_left === 1) {
        return { applied: false, reason: 'DUPLICATE_LEAVE', cycle: member.membership_cycle };
      }

      const attribution = {
        type: member.attribution_type || AttributionType.UNKNOWN,
        inviterId: member.inviter_id ?? null,
        inviteCode: member.invite_code ?? null,
      };
      const isFake = Boolean(member.is_fake);

      this.#insertEvent({
        guildId,
        userId,
        cycle: member.membership_cycle,
        eventType: 'LEAVE',
        attribution,
        isFake,
        occurredAt: leftAt,
      });
      this.#markMemberLeft({ guildId, userId, leftAt });
      this.#recordDailyStat(guildId, leftAt, 'leaves');
      this.#applyLeaveToInviter(guildId, userId, attribution, isFake);

      return { applied: true, reason: 'LEFT', cycle: member.membership_cycle };
    });
    return tx();
  }

  /**
   * Backfill pre-existing members. Idempotent — a second run inserts nothing
   * new. Pre-existing members never earn inviter credit.
   */
  syncPreExistingMembers(guildId, membersList) {
    let inserted = 0;
    const tx = this.db.transaction(() => {
      for (const m of membersList || []) {
        if (this.#getMember(guildId, m.userId)) continue;
        const attribution = { type: AttributionType.PRE_EXISTING, inviterId: null, inviteCode: null };
        const joinedAt = m.joinedAt || new Date().toISOString();
        this.#insertEvent({ guildId, userId: m.userId, cycle: 1, eventType: 'JOIN', attribution, isFake: m.isFake, occurredAt: joinedAt });
        this.#upsertMember({ guildId, userId: m.userId, cycle: 1, attribution, isFake: m.isFake, joinedAt });
        inserted += 1;
      }
    });
    tx();
    return inserted;
  }

  // --------------------------------------------------------------- bonuses

  /**
   * Bonus adjustments are the durable bonus history; inviters.bonus is only a
   * projection (rebuildable as SUM(amount)).
   */
  addBonus({ guildId, userId, amount, reason = null, actorUserId = null }) {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO invite_bonus_adjustments (guild_id, user_id, amount, reason, actor_user_id)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(guildId, userId, amount, reason, actorUserId);

      this.#ensureInviter(guildId, userId);
      this.db
        .prepare(`
          UPDATE inviters SET bonus = (
            SELECT COALESCE(SUM(amount), 0) FROM invite_bonus_adjustments
            WHERE guild_id = ? AND user_id = ?
          ), updated_at = CURRENT_TIMESTAMP
          WHERE guild_id = ? AND user_id = ?
        `)
        .run(guildId, userId, guildId, userId);
    });
    tx();
    return this.getInviter(guildId, userId);
  }

  // -------------------------------------------------------------- queries

  getInviter(guildId, userId) {
    const row = this.db
      .prepare(`
        SELECT user_id, regular, bonus, leaves, fake, total
        FROM inviter_stats
        WHERE guild_id = ? AND user_id = ?
      `)
      .get(guildId, userId);

    if (!row) {
      return { userId, guildId, regular: 0, bonus: 0, leaves: 0, fake: 0, total: 0 };
    }
    return {
      userId: row.user_id,
      guildId,
      regular: row.regular,
      bonus: row.bonus,
      leaves: row.leaves,
      fake: row.fake,
      total: row.total,
    };
  }

  getLeaderboard(guildId, { limit = 10, offset = 0 } = {}) {
    return this.db
      .prepare(`
        SELECT user_id, regular, bonus, leaves, fake, total
        FROM inviter_stats
        WHERE guild_id = ?
        ORDER BY total DESC, regular DESC, user_id ASC
        LIMIT ? OFFSET ?
      `)
      .all(guildId, limit, offset)
      .map((r) => ({
        userId: r.user_id,
        guildId,
        regular: r.regular,
        bonus: r.bonus,
        leaves: r.leaves,
        fake: r.fake,
        total: r.total,
      }));
  }

  getInvitersCount(guildId) {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM inviters WHERE guild_id = ?')
      .get(guildId);
    return row ? row.count : 0;
  }

  getDailyStats(guildId, days = 7) {
    const rows = this.db
      .prepare(`
        SELECT date, joins, leaves, fakes
        FROM daily_invite_stats
        WHERE guild_id = ?
        ORDER BY date DESC
        LIMIT ?
      `)
      .all(guildId, days);
    return rows.reverse().map((r) => ({
      date: r.date,
      joins: r.joins,
      leaves: r.leaves,
      fakes: r.fakes,
    }));
  }

  getCurrentMember(guildId, userId) {
    return this.#getMember(guildId, userId);
  }

  /**
   * Recent joins for the dashboard feed, ordered by most recent event.
   * @returns {Array<{userId, attribution: {type, inviterId, inviteCode}, joinedAt, isFake, isLeft, leftAt, inviteLabel, channelName}>}
   */
  getRecentJoins(guildId, limit = 10) {
    const rows = this.db
      .prepare(`
        SELECT
          im.user_id, im.inviter_id, im.invite_code, im.joined_at, im.is_fake,
          im.is_left, im.left_at, im.attribution_type,
          il.label AS invite_label, il.channel_name
        FROM invite_members im
        LEFT JOIN invite_labels il ON im.guild_id = il.guild_id AND im.invite_code = il.code
        WHERE im.guild_id = ?
        ORDER BY COALESCE(im.left_at, im.joined_at) DESC
        LIMIT ?
      `)
      .all(guildId, limit);

    return rows.map((r) => ({
      userId: r.user_id,
      attribution: {
        type: r.attribution_type || AttributionType.UNKNOWN,
        inviterId: r.inviter_id ?? null,
        inviteCode: r.invite_code ?? null,
      },
      joinedAt: r.joined_at,
      isFake: Boolean(r.is_fake),
      isLeft: Boolean(r.is_left),
      leftAt: r.left_at,
      inviteLabel: r.invite_label,
      channelName: r.channel_name,
    }));
  }

  /**
   * Detailed activity log over the durable ledger — one row per lifecycle event
   * (rejoins produce their own rows). Includes filter/search/pagination.
   */
  getActivityLog(guildId, { limit = 20, offset = 0, filter = 'all', search = '' } = {}) {
    const conditions = ['e.guild_id = ?'];
    const params = [guildId];

    if (filter === 'joins') {
      conditions.push("e.event_type = 'JOIN'");
    } else if (filter === 'leaves') {
      conditions.push("e.event_type = 'LEAVE'");
    } else if (filter === 'fakes') {
      conditions.push("e.event_type = 'JOIN' AND e.is_fake = 1");
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      conditions.push('(e.user_id LIKE ? OR e.inviter_id LIKE ? OR e.invite_code LIKE ? OR il.label LIKE ?)');
      params.push(s, s, s, s);
    }

    const where = conditions.join(' AND ');

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM invite_events e LEFT JOIN invite_labels il ON e.guild_id = il.guild_id AND e.invite_code = il.code WHERE ${where}`)
      .get(...params);
    const total = countRow ? countRow.count : 0;

    const items = this.db
      .prepare(`
        SELECT
          e.id, e.user_id, e.membership_cycle, e.event_type, e.attribution_type,
          e.inviter_id, e.invite_code, e.is_fake, e.occurred_at,
          (SELECT j.occurred_at FROM invite_events j
            WHERE j.guild_id = e.guild_id AND j.user_id = e.user_id
              AND j.membership_cycle = e.membership_cycle AND j.event_type = 'JOIN') AS joined_at,
          il.label AS invite_label, il.channel_name
        FROM invite_events e
        LEFT JOIN invite_labels il ON e.guild_id = il.guild_id AND e.invite_code = il.code
        WHERE ${where}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset);

    const summaryRow = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total_members,
          SUM(CASE WHEN is_left = 0 THEN 1 ELSE 0 END) AS active_joins,
          SUM(CASE WHEN is_left = 1 THEN 1 ELSE 0 END) AS total_leaves,
          SUM(CASE WHEN is_fake = 1 THEN 1 ELSE 0 END) AS total_fakes
        FROM invite_members
        WHERE guild_id = ?
      `)
      .get(guildId);

    const summary = {
      total: summaryRow?.total_members || 0,
      joins: summaryRow?.active_joins || 0,
      leaves: summaryRow?.total_leaves || 0,
      fakes: summaryRow?.total_fakes || 0,
    };

    return {
      items: items.map((r) => ({
        id: r.id,
        guildId,
        userId: r.user_id,
        membershipCycle: r.membership_cycle,
        eventType: r.event_type,
        attribution: {
          type: r.attribution_type || AttributionType.UNKNOWN,
          inviterId: r.inviter_id ?? null,
          inviteCode: r.invite_code ?? null,
        },
        isFake: Boolean(r.is_fake),
        isLeft: r.event_type === 'LEAVE',
        isPreExisting: r.attribution_type === AttributionType.PRE_EXISTING,
        joinedAt: r.joined_at,
        leftAt: r.event_type === 'LEAVE' ? r.occurred_at : null,
        inviteLabel: r.invite_label,
        channelName: r.channel_name,
      })),
      total,
      limit,
      offset,
      summary,
    };
  }

  // --------------------------------------------------------------- rebuild

  rebuildGuildProjections(guildId, options) {
    return rebuildGuildInviteProjections(this.db, guildId, options);
  }

  countInviteEvents(guildId) {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM invite_events WHERE guild_id = ?')
      .get(guildId);
    return row ? row.count : 0;
  }

  // ---------------------------------------------------------- invite labels

  setInviteLabel(guildId, code, label, channelId = null, channelName = null) {
    if (!label || !label.trim()) {
      return this.deleteInviteLabel(guildId, code);
    }
    const trimmed = label.trim();
    this.db
      .prepare(`
        INSERT INTO invite_labels (guild_id, code, label, channel_id, channel_name, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id, code) DO UPDATE SET
          label = excluded.label,
          channel_id = COALESCE(excluded.channel_id, invite_labels.channel_id),
          channel_name = COALESCE(excluded.channel_name, invite_labels.channel_name),
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(guildId, code, trimmed, channelId, channelName);
    return this.getInviteLabel(guildId, code);
  }

  getInviteLabel(guildId, code) {
    const row = this.db
      .prepare('SELECT * FROM invite_labels WHERE guild_id = ? AND code = ?')
      .get(guildId, code);
    return row || null;
  }

  getInviteLabels(guildId) {
    return this.db
      .prepare('SELECT * FROM invite_labels WHERE guild_id = ? ORDER BY created_at DESC')
      .all(guildId);
  }

  deleteInviteLabel(guildId, code) {
    this.db.prepare('DELETE FROM invite_labels WHERE guild_id = ? AND code = ?').run(guildId, code);
    return { success: true };
  }

  // ------------------------------------------------------------- invite cache

  saveCachedInvites(guildId, invites) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM invite_cache WHERE guild_id = ?').run(guildId);
      for (const inv of invites) {
        this.saveCachedInvite(guildId, inv);
      }
    });
    tx();
  }

  saveCachedInvite(guildId, invite) {
    this.db
      .prepare(`
        INSERT INTO invite_cache (guild_id, code, uses, inviter_id, max_uses, channel_id, channel_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, code) DO UPDATE SET
          uses = excluded.uses,
          inviter_id = COALESCE(excluded.inviter_id, invite_cache.inviter_id),
          max_uses = excluded.max_uses,
          channel_id = COALESCE(excluded.channel_id, invite_cache.channel_id),
          channel_name = COALESCE(excluded.channel_name, invite_cache.channel_name),
          created_at = COALESCE(excluded.created_at, invite_cache.created_at)
      `)
      .run(
        guildId,
        invite.code,
        invite.uses || 0,
        invite.inviterId || (invite.inviter ? invite.inviter.id : null) || null,
        invite.maxUses || 0,
        invite.channelId || null,
        invite.channelName || null,
        invite.createdAt ? new Date(invite.createdAt).toISOString() : new Date().toISOString()
      );
  }

  deleteCachedInvite(guildId, code) {
    this.db.prepare('DELETE FROM invite_cache WHERE guild_id = ? AND code = ?').run(guildId, code);
  }

  getCachedInvites(guildId) {
    return this.db
      .prepare(`
        SELECT
          c.code, c.uses, c.inviter_id AS inviterId, c.max_uses AS maxUses,
          c.channel_id AS channelId, c.channel_name AS channelName,
          c.created_at AS createdAt, l.label
        FROM invite_cache c
        LEFT JOIN invite_labels l ON c.guild_id = l.guild_id AND c.code = l.code
        WHERE c.guild_id = ?
        ORDER BY c.created_at DESC
      `)
      .all(guildId);
  }
}

module.exports = { InviteRepository };
