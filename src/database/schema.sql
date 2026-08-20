-- ⚠️ INFORMATIONAL ONLY — NOT used to create tables at runtime.
--
-- The authoritative schema history is `src/database/migrations/` (versioned,
-- applied transactionally, recorded in schema_migrations). This file documents
-- the final schema reached by running the full migration path so operators and
-- tools can reference it. Fresh and existing databases both reach this exact
-- schema through migrations — never edit schema.sql expecting a live effect.

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    is_left INTEGER DEFAULT 0,
    left_at DATETIME,
    membership_cycle INTEGER NOT NULL DEFAULT 1,
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
    membership_cycle INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('JOIN', 'LEAVE')),
    attribution_type TEXT NOT NULL CHECK (attribution_type IN ('INVITE', 'VANITY', 'UNKNOWN', 'PRE_EXISTING', 'OAUTH')),
    inviter_id TEXT,
    invite_code TEXT,
    is_fake INTEGER NOT NULL DEFAULT 0 CHECK (is_fake IN (0, 1)),
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

-- Operational archive of the pre-ledger mutable inviter aggregates, captured by
-- migration 003 BEFORE projections are rebuilt from the ledger. Information the
-- new event ledger cannot reproduce (e.g. lost rejoin history) is preserved
-- here instead of being irreversibly destroyed. Not used at runtime.
CREATE TABLE legacy_inviter_stats_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    regular INTEGER NOT NULL,
    bonus INTEGER NOT NULL,
    leaves INTEGER NOT NULL,
    fake INTEGER NOT NULL,
    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Operational archive of the pre-ledger daily statistics, captured by migration
-- 003 before the rebuild replaces daily_invite_stats (migration 004 backfills it
-- for databases that migrated before the archive existed). Preserves old daily
-- history the synthetic lifecycle ledger cannot reconstruct. Not used at runtime.
CREATE TABLE legacy_daily_invite_stats_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    date TEXT NOT NULL,
    joins INTEGER NOT NULL,
    leaves INTEGER NOT NULL,
    fakes INTEGER NOT NULL,
    captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Single definition of net invites: total = regular + bonus - leaves - fake.
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
