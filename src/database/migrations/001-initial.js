// Initial Mochi schema.
//
// Mochi is a new, pre-release project. Early prototype databases from the
// initial development period were disposable, so their migration history was
// consolidated into this single clean baseline instead of a chain of same-day
// compatibility migrations. From the first real deployment onward, migrations
// are append-only: the next schema change is migration 002.
//
// This migration creates the complete current application schema directly:
// durable lifecycle ledger (invite_events + invite_bonus_adjustments), the
// projections derived from it (invite_members, inviters, daily_invite_stats),
// the canonical statistics view, operational invite state (invite_cache,
// invite_labels) and guild settings. No backfill or compatibility logic exists
// because fresh databases never had a prior schema.
module.exports = {
  version: 1,
  name: 'initial',
  up(db) {
    db.exec(`
      CREATE TABLE guilds (
        guild_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        fake_threshold_days INTEGER DEFAULT 7,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE inviters (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        regular INTEGER DEFAULT 0,
        bonus INTEGER DEFAULT 0,
        leaves INTEGER DEFAULT 0,
        fake INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE invite_members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        inviter_id TEXT,
        invite_code TEXT,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_fake INTEGER DEFAULT 0,
        is_left INTEGER DEFAULT 0 CHECK (is_left IN (0, 1)),
        left_at DATETIME,
        membership_cycle INTEGER NOT NULL DEFAULT 1 CHECK (membership_cycle >= 1),
        attribution_type TEXT,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE invite_cache (
        guild_id TEXT NOT NULL,
        code TEXT NOT NULL,
        uses INTEGER DEFAULT 0,
        inviter_id TEXT,
        max_uses INTEGER DEFAULT 0,
        channel_id TEXT,
        channel_name TEXT,
        created_at DATETIME,
        PRIMARY KEY (guild_id, code)
      );

      CREATE TABLE invite_labels (
        guild_id TEXT NOT NULL,
        code TEXT NOT NULL,
        label TEXT NOT NULL,
        channel_id TEXT,
        channel_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, code)
      );

      CREATE TABLE daily_invite_stats (
        guild_id TEXT NOT NULL,
        date TEXT NOT NULL,
        joins INTEGER DEFAULT 0,
        leaves INTEGER DEFAULT 0,
        fakes INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, date)
      );

      CREATE TABLE invite_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        membership_cycle INTEGER NOT NULL CHECK (membership_cycle >= 1),
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

      CREATE TABLE invite_bonus_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT,
        actor_user_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- Single definition of net invites:
      --   total = regular + bonus - leaves - fake
      CREATE VIEW inviter_stats AS
      SELECT
        guild_id,
        user_id,
        regular,
        bonus,
        leaves,
        fake,
        regular + bonus - leaves - fake AS total
      FROM inviters;

      CREATE INDEX idx_invite_members_inviter ON invite_members (guild_id, inviter_id);
      CREATE INDEX idx_invite_labels_guild ON invite_labels (guild_id);
      CREATE INDEX idx_invite_events_guild_time ON invite_events (guild_id, occurred_at);
      CREATE INDEX idx_invite_events_guild_inviter ON invite_events (guild_id, inviter_id);
      CREATE INDEX idx_invite_events_guild_user ON invite_events (guild_id, user_id);
      CREATE INDEX idx_bonus_adjustments_guild_user ON invite_bonus_adjustments (guild_id, user_id);
    `);
  },
};
