const { AttributionType, attributionFromLegacyInviter } = require('../../features/invites/domain/attribution');
const { rebuildGuildInviteProjections } = require('../../features/invites/infrastructure/projectionRebuilder');

const LEGACY_BONUS_REASON = 'Legacy bonus imported during invite ledger migration';

// Existing databases contain current invite-member rows but not the historical
// lifecycle ledger. This migration synthesizes what is recoverable:
//   - one JOIN event per invite_members row (cycle 1)
//   - one LEAVE event per departed member (same cycle)
//   - one bonus adjustment per inviter with a non-zero bonus
// then archives the OLD mutable aggregate counters and rebuilds the member,
// inviter and daily projections from the new ledger.
//
// Lost historical rejoin information cannot be recovered; the new ledger
// becomes the source of truth. The archived legacy snapshot preserves the old
// aggregate information that the new ledger may not reproduce, and a UNION
// reconciliation report lists every removed/added/changed inviter row so no
// difference is silently lost.
//
// The migration is idempotent by construction: it only ever runs once because
// the version table records it, and every insert guards against re-inserting
// rows that already exist in the ledger.

function hasTable(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return Boolean(row);
}

module.exports = {
  version: 3,
  name: 'backfill-invite-ledger',
  up(db) {
    if (!hasTable(db, 'invite_members') || !hasTable(db, 'inviters')) {
      return;
    }

    const members = db
      .prepare(`
        SELECT guild_id, user_id, inviter_id, invite_code, joined_at, is_fake, is_left, left_at
        FROM invite_members
      `)
      .all();

    const insertJoin = db.prepare(`
      INSERT INTO invite_events
        (guild_id, user_id, membership_cycle, event_type, attribution_type,
         inviter_id, invite_code, is_fake, occurred_at)
      SELECT ?, ?, 1, 'JOIN', ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM invite_events
        WHERE guild_id = ? AND user_id = ? AND membership_cycle = 1 AND event_type = 'JOIN'
      )
    `);

    const insertLeave = db.prepare(`
      INSERT INTO invite_events
        (guild_id, user_id, membership_cycle, event_type, attribution_type,
         inviter_id, invite_code, is_fake, occurred_at)
      SELECT ?, ?, 1, 'LEAVE', ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM invite_events
        WHERE guild_id = ? AND user_id = ? AND membership_cycle = 1 AND event_type = 'LEAVE'
      )
    `);

    let joinEvents = 0;
    let leaveEvents = 0;

    const updateMemberProjection = db.prepare(`
      UPDATE invite_members
      SET attribution_type = ?, inviter_id = ?, invite_code = ?, membership_cycle = 1
      WHERE guild_id = ? AND user_id = ?
    `);

    for (const m of members) {
      const attribution = attributionFromLegacyInviter(m.inviter_id);
      // The legacy 'PRE_EXISTING' marker maps to PRE_EXISTING; any other real
      // value is a Discord inviter ID. Vanity code was stored as inviter_id.
      const type = m.inviter_id === AttributionType.PRE_EXISTING
        ? AttributionType.PRE_EXISTING
        : attribution.type;
      const inviterId = type === AttributionType.INVITE ? m.inviter_id : null;
      const inviteCode = type === AttributionType.VANITY && !m.invite_code
        ? AttributionType.VANITY
        : m.invite_code;

      joinEvents += insertJoin.run(
        m.guild_id, m.user_id, type, inviterId, inviteCode, m.is_fake ? 1 : 0, m.joined_at,
        m.guild_id, m.user_id
      ).changes;

      if (m.is_left) {
        leaveEvents += insertLeave.run(
          m.guild_id, m.user_id, type, inviterId, inviteCode, m.is_fake ? 1 : 0, m.left_at,
          m.guild_id, m.user_id
        ).changes;
      }

      // Normalize the member projection so it never carries sentinel inviter
      // IDs and always knows its attribution type (used by future leave ops).
      updateMemberProjection.run(type, inviterId, inviteCode, m.guild_id, m.user_id);
    }

    // Import existing bonus values as one synthetic adjustment per inviter.
    const invitersWithBonus = db
      .prepare('SELECT guild_id, user_id, bonus FROM inviters WHERE bonus IS NOT NULL AND bonus != 0')
      .all();

    const hasLegacyAdjustment = db.prepare(`
      SELECT 1 FROM invite_bonus_adjustments
      WHERE guild_id = ? AND user_id = ? AND reason = ?
    `);
    const insertBonus = db.prepare(`
      INSERT INTO invite_bonus_adjustments (guild_id, user_id, amount, reason)
      VALUES (?, ?, ?, ?)
    `);

    let importedBonuses = 0;
    for (const inv of invitersWithBonus) {
      if (hasLegacyAdjustment.get(inv.guild_id, inv.user_id, LEGACY_BONUS_REASON)) continue;
      insertBonus.run(inv.guild_id, inv.user_id, inv.bonus, LEGACY_BONUS_REASON);
      importedBonuses += 1;
    }

    // Archive the OLD mutable aggregate counters BEFORE rebuilding so that
    // information the new ledger cannot reproduce is never irreversibly lost.
    db.exec(`
      CREATE TABLE IF NOT EXISTS legacy_inviter_stats_snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        regular INTEGER NOT NULL,
        bonus INTEGER NOT NULL,
        leaves INTEGER NOT NULL,
        fake INTEGER NOT NULL,
        captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // NOTE: explicit parentheses around the non-zero predicate. SQL precedence
    // would otherwise bind `AND NOT EXISTS` only to the last `fake != 0` term,
    // so an already-archived row with only fake != 0 would be re-archived.
    const archiveInsert = db.prepare(`
      INSERT INTO legacy_inviter_stats_snapshot (guild_id, user_id, regular, bonus, leaves, fake)
      SELECT guild_id, user_id, regular, bonus, leaves, fake FROM inviters
      WHERE (regular != 0 OR bonus != 0 OR leaves != 0 OR fake != 0)
        AND NOT EXISTS (
          SELECT 1 FROM legacy_inviter_stats_snapshot s
          WHERE s.guild_id = inviters.guild_id AND s.user_id = inviters.user_id
            AND s.regular = inviters.regular AND s.bonus = inviters.bonus
            AND s.leaves = inviters.leaves AND s.fake = inviters.fake
        )
    `);
    const archivedCount = archiveInsert.run().changes;

    // The old DAILY statistics can contain history that the synthetic lifecycle
    // ledger cannot reconstruct, so archive them BEFORE the rebuild replaces
    // daily_invite_stats. Same explicit-parenthesis discipline applies.
    db.exec(`
      CREATE TABLE IF NOT EXISTS legacy_daily_invite_stats_snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        date TEXT NOT NULL,
        joins INTEGER NOT NULL,
        leaves INTEGER NOT NULL,
        fakes INTEGER NOT NULL,
        captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const archiveDailyInsert = db.prepare(`
      INSERT INTO legacy_daily_invite_stats_snapshot (guild_id, date, joins, leaves, fakes)
      SELECT guild_id, date, joins, leaves, fakes FROM daily_invite_stats
      WHERE NOT EXISTS (
        SELECT 1 FROM legacy_daily_invite_stats_snapshot s
        WHERE s.guild_id = daily_invite_stats.guild_id
          AND s.date = daily_invite_stats.date
          AND s.joins = daily_invite_stats.joins
          AND s.leaves = daily_invite_stats.leaves
          AND s.fakes = daily_invite_stats.fakes
      )
    `);
    const archivedDailyCount = archiveDailyInsert.run().changes;

    // Capture old counters for reconciliation before rebuilding from the ledger.
    const oldCounters = db
      .prepare(`
        SELECT guild_id, user_id, regular, bonus, leaves, fake
        FROM inviters WHERE (regular != 0 OR bonus != 0 OR leaves != 0 OR fake != 0)
      `)
      .all();
    const oldByKey = new Map(oldCounters.map((r) => [`${r.guild_id}:${r.user_id}`, r]));

    const guildIds = db.prepare('SELECT DISTINCT guild_id FROM invite_members').all().map((r) => r.guild_id);
    let rebuiltGuilds = 0;
    for (const guildId of guildIds) {
      rebuildGuildInviteProjections(db, guildId);
      rebuiltGuilds += 1;
    }

    const newCounters = db
      .prepare(`
        SELECT guild_id, user_id, regular, bonus, leaves, fake
        FROM inviters WHERE (regular != 0 OR bonus != 0 OR leaves != 0 OR fake != 0)
      `)
      .all();
    const newByKey = new Map(newCounters.map((r) => [`${r.guild_id}:${r.user_id}`, r]));

    // UNION reconciliation: consider both removed old rows and newly created
    // rows, not just rows that survived the rebuild. This catches "old inviter
    // existed, new projection has no row" which the old comparison missed.
    const unionKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
    const mismatches = [];
    const differences = [];
    let removed = 0;
    let added = 0;

    for (const key of unionKeys) {
      const old = oldByKey.get(key);
      const next = newByKey.get(key);
      if (!old && next) {
        added += 1;
        differences.push({ key, reason: 'ADDED (only in rebuilt ledger)', before: null, after: next });
      } else if (old && !next) {
        removed += 1;
        differences.push({ key, reason: 'REMOVED (legacy aggregate not reconstructible)', before: old, after: null });
      } else if (
        old &&
        (old.regular !== next.regular || old.bonus !== next.bonus ||
         old.leaves !== next.leaves || old.fake !== next.fake)
      ) {
        mismatches.push({ guild_id: next.guild_id, user_id: next.user_id, before: old, after: next });
        differences.push({ key, reason: 'CHANGED (expected where history is unrecoverable)', before: old, after: next });
      }
    }

    console.log(
      `[Database] Migration 3 backfill: imported ${joinEvents} join histories, ${leaveEvents} leave histories, ` +
      `${importedBonuses} bonus adjustments, rebuilt ${rebuiltGuilds} guilds, archived ${archivedCount} legacy inviter snapshot row(s), ` +
      `${archivedDailyCount} legacy daily snapshot row(s).`
    );

    if (differences.length > 0) {
      const expected = removed + mismatches.length;
      console.warn(
        `[Database] Migration 3 reconciliation: ${expected} expected difference(s) from unrecoverable legacy history ` +
        `(${removed} removed, ${mismatches.length} changed) and ${added} row(s) newly derived from the ledger. ` +
        `Old aggregates were archived in legacy_inviter_stats_snapshot; the ledger is now the source of truth.`
      );
      for (const d of differences.slice(0, 5)) {
        console.warn(`  ${d.reason}: guild/user=${d.key} before=${JSON.stringify(d.before)} after=${JSON.stringify(d.after)}`);
      }
    }
  },
};
