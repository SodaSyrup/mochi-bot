// Invite lifecycle ledger.
//
// invite_members becomes a projection of the CURRENT membership state:
// it gains membership_cycle and attribution_type so rejoin history is
// representable without overwriting historical events. The durable history
// itself lives in invite_events (append-only) and invite_bonus_adjustments
// (bonus history). inviter counters become projections over this ledger and
// are read through the inviter_stats view.
function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

module.exports = {
  version: 2,
  name: 'invite-ledger',
  up(db) {
    if (!hasColumn(db, 'invite_members', 'membership_cycle')) {
      db.exec('ALTER TABLE invite_members ADD COLUMN membership_cycle INTEGER NOT NULL DEFAULT 1');
    }
    if (!hasColumn(db, 'invite_members', 'attribution_type')) {
      db.exec('ALTER TABLE invite_members ADD COLUMN attribution_type TEXT');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS invite_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,

        membership_cycle INTEGER NOT NULL,

        event_type TEXT NOT NULL
          CHECK (event_type IN ('JOIN', 'LEAVE')),

        attribution_type TEXT NOT NULL
          CHECK (
            attribution_type IN (
              'INVITE',
              'VANITY',
              'UNKNOWN',
              'PRE_EXISTING',
              'OAUTH'
            )
          ),

        inviter_id TEXT,
        invite_code TEXT,

        is_fake INTEGER NOT NULL DEFAULT 0
          CHECK (is_fake IN (0, 1)),

        occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        UNIQUE (guild_id, user_id, membership_cycle, event_type)
      );

      CREATE INDEX IF NOT EXISTS idx_invite_events_guild_time
        ON invite_events (guild_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_invite_events_guild_inviter
        ON invite_events (guild_id, inviter_id);
      CREATE INDEX IF NOT EXISTS idx_invite_events_guild_user
        ON invite_events (guild_id, user_id);

      CREATE TABLE IF NOT EXISTS invite_bonus_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT,
        actor_user_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_bonus_adjustments_guild_user
        ON invite_bonus_adjustments (guild_id, user_id);

      -- Single definition of net invites:
      --   total = regular + bonus - leaves - fake
      CREATE VIEW IF NOT EXISTS inviter_stats AS
      SELECT
        guild_id,
        user_id,
        regular,
        bonus,
        leaves,
        fake,
        regular + bonus - leaves - fake AS total
      FROM inviters;
    `);
  },
};
