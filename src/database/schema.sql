-- ⚠️ INFORMATIONAL ONLY — NOT used to create tables at runtime.
--
-- The authoritative schema history is `src/database/migrations/` (versioned,
-- applied transactionally, recorded in schema_migrations). Migration 001 is the
-- clean baseline; migration 002 adds the invite-log channel and bot attribution.
-- From the first real deployment onward, migrations are append-only: future
-- schema changes come as 003, 004, … and shipped migrations are never rewritten.

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
    invite_log_channel_id TEXT,
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

-- Durable lifecycle ledger — the source of truth for all projections.
CREATE TABLE invite_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    membership_cycle INTEGER NOT NULL CHECK (membership_cycle >= 1),
    event_type TEXT NOT NULL CHECK (event_type IN ('JOIN', 'LEAVE')),
    attribution_type TEXT NOT NULL CHECK (attribution_type IN ('INVITE', 'VANITY', 'UNKNOWN', 'PRE_EXISTING', 'OAUTH')),
    inviter_id TEXT,
    invite_code TEXT,
    is_fake INTEGER NOT NULL DEFAULT 0 CHECK (is_fake IN (0, 1)),
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, user_id, membership_cycle, event_type)
);

-- Durable bonus history; inviters.bonus is a rebuildable projection of this.
CREATE TABLE invite_bonus_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT,
    actor_user_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Who originally added a bot to a guild. Deliberately OUTSIDE the human invite
-- ledger so bots never affect invite statistics; the username snapshot survives
-- the adder leaving the guild. Added by migration 002.
CREATE TABLE bot_attributions (
    guild_id TEXT NOT NULL,
    bot_user_id TEXT NOT NULL,
    added_by_user_id TEXT,
    added_by_username TEXT,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, bot_user_id)
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
