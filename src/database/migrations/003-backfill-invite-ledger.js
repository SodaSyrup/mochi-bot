const { AttributionType, attributionFromLegacyInviter } = require('../../features/invites/domain/attribution');
const { rebuildGuildInviteProjections } = require('../../features/invites/infrastructure/projectionRebuilder');

const LEGACY_BONUS_REASON = 'Legacy bonus imported during invite ledger migration';

// Existing databases contain current invite-member rows but not the historical
// lifecycle ledger. This migration synthesizes what is recoverable:
//   - one JOIN event per invite_members row (cycle 1)
//   - one LEAVE event per departed member (same cycle)
//   - one bonus adjustment per inviter with a non-zero bonus
// and then rebuilds inviter/daily projections from the new ledger.
//
// Lost historical rejoin information cannot be recovered; the new ledger
// becomes the source of truth and any mismatch with the old mutable aggregates
// is reported rather than silently resolved.

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

    // Capture old counters for reconciliation before rebuilding from the ledger.
    const oldCounters = db
      .prepare(`
        SELECT guild_id, user_id, regular, bonus, leaves, fake
        FROM inviters WHERE regular != 0 OR bonus != 0 OR leaves != 0 OR fake != 0
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
        FROM inviters WHERE regular != 0 OR bonus != 0 OR leaves != 0 OR fake != 0
      `)
      .all();

    const mismatches = [];
    for (const row of newCounters) {
      const key = `${row.guild_id}:${row.user_id}`;
      const old = oldByKey.get(key);
      if (
        old &&
        (old.regular !== row.regular || old.bonus !== row.bonus ||
         old.leaves !== row.leaves || old.fake !== row.fake)
      ) {
        mismatches.push({ guild_id: row.guild_id, user_id: row.user_id, before: old, after: row });
      }
    }

    console.log(
      `[Database] Migration 3 backfill: ${joinEvents} join events, ${leaveEvents} leave events, ` +
      `${importedBonuses} bonus adjustments imported, ${rebuiltGuilds} guilds rebuilt.`
    );
    if (mismatches.length > 0) {
      console.warn(
        `[Database] Migration 3 reconciliation: ${mismatches.length} inviter row(s) differ from the rebuilt ledger ` +
        `(ledger is now the source of truth).`
      );
      for (const m of mismatches.slice(0, 5)) {
        console.warn(`  guild=${m.guild_id} user=${m.user_id} before=${JSON.stringify(m.before)} after=${JSON.stringify(m.after)}`);
      }
    }
  },
};
