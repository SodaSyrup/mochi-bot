/**
 * Single source of truth for "which guilds currently have invite-related
 * persistence state?".
 *
 * Every "rebuild all guilds" operation (the projection rebuild CLI, future
 * maintenance tools) MUST discover guilds through this helper so no operation
 * ever maintains its own alternate definition. A guild is discoverable from
 * the durable ledger tables AND the projection tables: the rebuild utility is
 * also an integrity/repair mechanism, so a guild that only exists in stale
 * projections must still be found and cleared/rebuilt.
 */

// Tables that carry a guild-scoped invite state. The UNION de-duplicates, so a
// guild appearing in several tables is returned exactly once.
const GUILD_ID_SOURCES = [
  'invite_events',
  'invite_bonus_adjustments',
  'invite_members',
  'inviters',
  'daily_invite_stats',
];

function hasTable(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return Boolean(row);
}

/**
 * Return the unique union of guild IDs with any invite-related persistence
 * state, from all durable ledger tables and projection tables.
 *
 * @param {object} db - a prepared-statement-compatible database handle
 * @returns {string[]} de-duplicated guild IDs in insertion order
 */
function getGuildIdsWithInviteData(db) {
  const existing = GUILD_ID_SOURCES.filter((table) => hasTable(db, table));
  if (existing.length === 0) return [];
  const unionSql = existing
    .map((table) => `SELECT guild_id FROM ${table}`)
    .join('\nUNION\n');
  return db.prepare(unionSql).all().map((r) => r.guild_id);
}

module.exports = { getGuildIdsWithInviteData };
