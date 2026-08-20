// Databases that already ran migration 003 replaced their daily_invite_stats
// before any daily archive existed, so their pre-ledger daily history was not
// preserved. This migration backfills the archive table ONCE with whatever
// daily_invite_stats currently holds so the old aggregate information is never
// silently lost.
//
// Fresh databases never reach this migration with data: migration 003 already
// archived the legacy daily rows before rebuilding them, so the snapshot is
// non-empty and this migration is a no-op. Idempotency is guaranteed by the
// snapshot-empty guard plus the per-row NOT EXISTS check.
//
// The legacy daily snapshot mirrors daily_invite_stats so the old aggregate
// (joins/leaves/fakes per guild per day) stays fully interpretable offline.

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

    db.prepare(`
      INSERT INTO legacy_daily_invite_stats_snapshot (guild_id, date, joins, leaves, fakes)
      SELECT guild_id, date, joins, leaves, fakes FROM daily_invite_stats
      WHERE NOT EXISTS (
        SELECT 1 FROM legacy_daily_invite_stats_snapshot s
        WHERE s.guild_id = daily_invite_stats.guild_id
          AND s.date = daily_invite_stats.date
      )
    `).run();
  },
};
