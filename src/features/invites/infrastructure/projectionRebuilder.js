const { AttributionType } = require('../domain/attribution');

/**
 * Rebuild a guild's member, inviter and daily projections from the durable
 * ledger (invite_events + invite_bonus_adjustments).
 *
 * This is the single definition of how projections are derived from history:
 *  - invite_members: derived from the LATEST membership cycle per (guild,user).
 *  - regular:        INVITE JOIN events with a real, non-self inviter
 *  - fake:           those same JOIN events classified as suspicious
 *  - leaves:         INVITE LEAVE events with a real, non-self inviter that were
 *                    not already excluded by the fake counter (no double penalty)
 *  - bonus:          SUM(invite_bonus_adjustments.amount)
 *  - daily joins/fakes: JOIN events split by fake status; daily leaves count
 *                    every literal departure
 *
 * The whole guild rebuild runs inside ONE transaction: if any validation fails
 * (malformed ledger) or any write fails, everything rolls back. Projection
 * rebuilding must not partially succeed.
 */

// Thrown when the ledger is in an impossible state that prevents a truthful
// rebuild. Carries the offending guild/user/cycle/event so operators can fix it.
class ProjectionRebuildError extends Error {
  constructor(guildId, userId, message) {
    super(`Projection rebuild failed for guild ${guildId}${userId ? `, user ${userId}` : ''}: ${message}`);
    this.name = 'ProjectionRebuildError';
    this.guildId = guildId;
    this.userId = userId;
  }
}

/**
 * Normalize a possibly-mixed timestamp (ISO string vs SQLite datetime string
 * like `2026-01-01 10:00:00`) to epoch milliseconds. Returns null for
 * missing/blank values and NaN-encoding-invalid values are rejected by the
 * caller. Never compare raw timestamp strings lexicographically.
 */
function toEpochMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Run a function inside an IMMEDIATE transaction so no other writer can slip
 * between the ledger read and the projection replacement. When a transaction
 * is already active (e.g. the migration runner wraps each migration) the outer
 * transaction provides the boundary and we simply execute inside it.
 */
function withImmediateTransaction(db, fn) {
  if (db.inTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Transaction may already be rolled back; the original error wins.
    }
    throw err;
  }
}

function rebuildGuildInviteProjections(db, guildId, { dryRun = false } = {}) {
  // The authoritative ledger snapshot and the projection replacement run
  // inside ONE IMMEDIATE transaction for the write path. Reads, derivation,
  // validation and replacement all happen on the same snapshot so a rebuild
  // can never overwrite newer live state that arrived mid-rebuild.
  const build = () => {
    const joinRows = db
      .prepare(`
        SELECT id, user_id, membership_cycle, inviter_id, invite_code, is_fake,
               attribution_type, occurred_at
        FROM invite_events
        WHERE guild_id = ? AND event_type = 'JOIN'
      `)
      .all(guildId);

    const leaveRows = db
      .prepare(`
        SELECT id, user_id, membership_cycle, inviter_id, is_fake, attribution_type, occurred_at
        FROM invite_events
        WHERE guild_id = ? AND event_type = 'LEAVE'
      `)
      .all(guildId);

    const bonusRows = db
      .prepare(`
        SELECT user_id, amount FROM invite_bonus_adjustments WHERE guild_id = ?
      `)
      .all(guildId);

    const dailyRows = db
      .prepare(`
        SELECT event_type, attribution_type, is_fake, substr(occurred_at, 1, 10) AS day
        FROM invite_events
        WHERE guild_id = ?
      `)
      .all(guildId);

    // ----------------------------------------------- derive projections

    // Group JOIN/LEAVE events per user/cycle and derive the current membership.
    const membersByUser = new Map();
    for (const row of joinRows) {
      const cycles = membersByUser.get(row.user_id) || new Map();
      cycles.set(row.membership_cycle, { join: row, leave: null });
      membersByUser.set(row.user_id, cycles);
    }
    for (const row of leaveRows) {
      const cycles = membersByUser.get(row.user_id);
      if (!cycles) {
        // LEAVE for a user with no JOIN anywhere -> impossible state.
        throw new ProjectionRebuildError(guildId, row.user_id, `LEAVE (id=${row.id}) without any JOIN`);
      }
      const cycle = cycles.get(row.membership_cycle);
      if (!cycle) {
        throw new ProjectionRebuildError(guildId, row.user_id, `LEAVE (id=${row.id}) in cycle ${row.membership_cycle} without a JOIN`);
      }
      if (cycle.leave) {
        throw new ProjectionRebuildError(guildId, row.user_id, `duplicate LEAVE in cycle ${row.membership_cycle}`);
      }
      cycle.leave = row;
    }

    const memberProjections = [];
    for (const [userId, cycles] of membersByUser) {
      const cycleNumbers = Array.from(cycles.keys()).sort((a, b) => a - b);
      const max = cycleNumbers[cycleNumbers.length - 1];
      // Cycles must be a contiguous 1..max sequence (rejoin increments by 1).
      for (let c = 1; c <= max; c++) {
        if (!cycles.has(c)) {
          throw new ProjectionRebuildError(guildId, userId, `membership cycles are not contiguous (missing cycle ${c})`);
        }
      }

      for (const c of cycleNumbers) {
        const { join, leave } = cycles.get(c);
        const joinMs = toEpochMs(join.occurred_at);
        const leaveMs = toEpochMs(leave?.occurred_at);
        if (joinMs === null) {
          throw new ProjectionRebuildError(guildId, userId, `JOIN in cycle ${c} has an invalid occurred_at timestamp`);
        }
        // Timestamps may mix SQLite and ISO encodings; compare numerically.
        if (leaveMs !== null && joinMs > leaveMs) {
          throw new ProjectionRebuildError(guildId, userId, `LEAVE in cycle ${c} occurs before its JOIN`);
        }
      }

      const latest = cycles.get(max);
      const join = latest.join;
      const leave = latest.leave;
      memberProjections.push({
        guildId,
        userId,
        cycle: max,
        isLeft: Boolean(leave),
        joinedAt: join.occurred_at,
        leftAt: leave ? leave.occurred_at : null,
        attributionType: join.attribution_type || AttributionType.UNKNOWN,
        inviterId: join.inviter_id ?? null,
        inviteCode: join.invite_code ?? null,
        isFake: Boolean(join.is_fake),
      });
    }

    const counts = new Map();
    const getCounts = (userId) => {
      if (!counts.has(userId)) {
        counts.set(userId, { regular: 0, leaves: 0, fake: 0, bonus: 0 });
      }
      return counts.get(userId);
    };

    for (const row of joinRows) {
      if (row.attribution_type === AttributionType.INVITE && row.inviter_id && row.inviter_id !== row.user_id) {
        const c = getCounts(row.inviter_id);
        c.regular += 1;
        if (row.is_fake) c.fake += 1;
      }
    }

    for (const row of leaveRows) {
      if (row.attribution_type === AttributionType.INVITE && row.inviter_id && row.inviter_id !== row.user_id && !row.is_fake) {
        const c = getCounts(row.inviter_id);
        c.leaves += 1;
      }
    }

    for (const row of bonusRows) {
      getCounts(row.user_id).bonus += row.amount;
    }

    const dayCounts = new Map();
    for (const row of dailyRows) {
      if (!row.day) continue;
      if (!dayCounts.has(row.day)) dayCounts.set(row.day, { joins: 0, leaves: 0, fakes: 0 });
      const d = dayCounts.get(row.day);
      if (row.event_type === 'LEAVE') {
        d.leaves += 1;
      } else if (row.attribution_type === AttributionType.PRE_EXISTING) {
        // Pre-existing backfill never produced daily stats at sync time, so
        // rebuilding must not invent them.
        continue;
      } else if (row.is_fake) {
        d.fakes += 1;
      } else {
        d.joins += 1;
      }
    }

    // ------------------------------------------- atomically replace rows

    // Dry-run mode computes the diff without writing so operators can preview
    // exactly what a rebuild would change.
    if (dryRun) {
      return buildDryRunDiff(db, guildId, { memberProjections, counts, dayCounts });
    }

    // invite_members (current membership projection)
    db.prepare('DELETE FROM invite_members WHERE guild_id = ?').run(guildId);
    const insertMember = db.prepare(`
      INSERT INTO invite_members
        (guild_id, user_id, inviter_id, invite_code, joined_at, is_fake, is_left,
         left_at, membership_cycle, attribution_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of memberProjections) {
      insertMember.run(
        m.guildId,
        m.userId,
        m.inviterId,
        m.inviteCode,
        m.joinedAt,
        m.isFake ? 1 : 0,
        m.isLeft ? 1 : 0,
        m.leftAt,
        m.cycle,
        m.attributionType
      );
    }

    // inviters
    db.prepare('DELETE FROM inviters WHERE guild_id = ?').run(guildId);
    const insertInviter = db.prepare(`
      INSERT INTO inviters (guild_id, user_id, regular, bonus, leaves, fake, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    for (const [userId, c] of counts) {
      insertInviter.run(guildId, userId, c.regular, c.bonus, c.leaves, c.fake);
    }

    // daily_invite_stats
    db.prepare('DELETE FROM daily_invite_stats WHERE guild_id = ?').run(guildId);
    const insertDaily = db.prepare(`
      INSERT INTO daily_invite_stats (guild_id, date, joins, leaves, fakes)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const [date, d] of dayCounts) {
      insertDaily.run(guildId, date, d.joins, d.leaves, d.fakes);
    }

    return { inviters: counts.size, days: dayCounts.size, members: memberProjections.length };
  };

  return dryRun ? build() : withImmediateTransaction(db, build);
}

/**
 * Compare derived projections against the current rows and report every
 * difference. Read-only — never writes.
 */
function buildDryRunDiff(db, guildId, { memberProjections, counts, dayCounts }) {
  const differences = [];

  const currentMembers = db
    .prepare(`
      SELECT user_id, inviter_id, invite_code, joined_at, is_fake, is_left, left_at,
             membership_cycle, attribution_type
      FROM invite_members WHERE guild_id = ?
    `)
    .all(guildId);
  const memberByUser = new Map(currentMembers.map((r) => [r.user_id, r]));
  for (const m of memberProjections) {
    const cur = memberByUser.get(m.userId);
    if (!cur) {
      differences.push({ table: 'invite_members', user: m.userId, reason: 'MEMBER ADDED' });
      continue;
    }
    // Timestamps are compared in normalized epoch milliseconds because the
    // ledger and the projection may use mixed SQLite/ISO encodings.
    const joinedAtDiff = toEpochMs(cur.joined_at) !== toEpochMs(m.joinedAt);
    const leftAtDiff = toEpochMs(cur.left_at) !== toEpochMs(m.leftAt);
    if (
      cur.inviter_id !== m.inviterId ||
      cur.invite_code !== m.inviteCode ||
      cur.is_left !== (m.isLeft ? 1 : 0) ||
      joinedAtDiff ||
      leftAtDiff ||
      cur.membership_cycle !== m.cycle ||
      cur.attribution_type !== m.attributionType ||
      cur.is_fake !== (m.isFake ? 1 : 0)
    ) {
      differences.push({ table: 'invite_members', user: m.userId, reason: 'MEMBER CHANGED' });
    }
  }
  for (const cur of currentMembers) {
    if (!memberProjections.some((m) => m.userId === cur.user_id)) {
      differences.push({ table: 'invite_members', user: cur.user_id, reason: 'MEMBER REMOVED' });
    }
  }

  const currentInviters = db
    .prepare(`
      SELECT user_id, regular, bonus, leaves, fake FROM inviters WHERE guild_id = ?
    `)
    .all(guildId);
  const inviterByUser = new Map(currentInviters.map((r) => [r.user_id, r]));
  for (const [userId, c] of counts) {
    const cur = inviterByUser.get(userId);
    if (!cur) {
      differences.push({ table: 'inviters', user: userId, reason: 'INVITER ADDED' });
      continue;
    }
    if (cur.regular !== c.regular || cur.bonus !== c.bonus || cur.leaves !== c.leaves || cur.fake !== c.fake) {
      differences.push({ table: 'inviters', user: userId, reason: 'INVITER CHANGED' });
    }
  }
  for (const cur of currentInviters) {
    if (!counts.has(cur.user_id)) {
      differences.push({ table: 'inviters', user: cur.user_id, reason: 'INVITER REMOVED' });
    }
  }

  const currentDaily = db
    .prepare(`SELECT date, joins, leaves, fakes FROM daily_invite_stats WHERE guild_id = ?`)
    .all(guildId);
  const dailyByDate = new Map(currentDaily.map((r) => [r.date, r]));
  for (const [date, d] of dayCounts) {
    const cur = dailyByDate.get(date);
    if (!cur) {
      differences.push({ table: 'daily_invite_stats', user: date, reason: 'DAY ADDED' });
      continue;
    }
    if (cur.joins !== d.joins || cur.leaves !== d.leaves || cur.fakes !== d.fakes) {
      differences.push({ table: 'daily_invite_stats', user: date, reason: 'DAY CHANGED' });
    }
  }
  for (const cur of currentDaily) {
    if (!dayCounts.has(cur.date)) {
      differences.push({ table: 'daily_invite_stats', user: cur.date, reason: 'DAY REMOVED' });
    }
  }

  return {
    inviters: counts.size,
    days: dayCounts.size,
    members: memberProjections.length,
    dryRun: true,
    differences,
  };
}

module.exports = { rebuildGuildInviteProjections, ProjectionRebuildError };
