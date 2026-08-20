// Databases that already ran the earlier ledger migration (003) had their
// pre-ledger daily_invite_stats replaced by the synthetic ledger rebuild before
// any daily archive existed. Those original historical aggregates are NOT
// recoverable from this database — only an external backup can restore them.
// This migration archives the daily statistics CURRENTLY present so no
// remaining pre-archive state is silently discarded either.
//
// Fresh databases never reach this migration with data: migration 003 already
// archived the legacy daily rows before rebuilding them, so the snapshot is
// non-empty and this migration is a no-op. Idempotency is guaranteed by the
// snapshot-empty guard plus the per-row NOT EXISTS check.
//
// The legacy daily snapshot mirrors whatever daily_invite_stats currently
// holds so that state stays fully interpretable offline. It cannot recover
// history that an earlier migration 003 already destroyed and replaced.

function hasTable(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return Boolean(row);
}

module.exports = {
  version: 4,
  name: 'archive-legacy-daily-stats',
  up(db) {
    if (!hasTable(db, 'daily_invite_stats')) return;

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

    // Already archived by migration 003 on the fresh-migration path.
    const existing = db.prepare('SELECT COUNT(*) AS c FROM legacy_daily_invite_stats_snapshot').get();
    if (existing.c > 0) return;

    const remaining = db.prepare('SELECT COUNT(*) AS c FROM daily_invite_stats').get();
    if (remaining.c > 0) {
      console.warn(
        '[Database] Legacy daily history prior to migration 003 may no longer be recoverable from this ' +
        'database. Restore from a pre-migration backup if that history is required.'
      );
    }

    const archived = db.prepare(`
      INSERT INTO legacy_daily_invite_stats_snapshot (guild_id, date, joins, leaves, fakes)
      SELECT guild_id, date, joins, leaves, fakes FROM daily_invite_stats
      WHERE NOT EXISTS (
        SELECT 1 FROM legacy_daily_invite_stats_snapshot s
        WHERE s.guild_id = daily_invite_stats.guild_id
          AND s.date = daily_invite_stats.date
      )
    `).run();
    if (archived.changes > 0) {
      console.log(
        `[Database] Migration 4 archived ${archived.changes} current daily aggregate row(s) for a database ` +
        `that migrated before the daily archive existed.`
      );
    }
  },
};
