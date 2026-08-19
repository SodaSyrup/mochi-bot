-- Mochi Discord Bot Database Schema (SQLite)

CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    fake_threshold_days INTEGER DEFAULT 7,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inviters (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    regular INTEGER DEFAULT 0,
    bonus INTEGER DEFAULT 0,
    leaves INTEGER DEFAULT 0,
    fake INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS invite_members (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    inviter_id TEXT,
    invite_code TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_fake INTEGER DEFAULT 0,
    is_left INTEGER DEFAULT 0,
    left_at DATETIME,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS invite_cache (
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

CREATE TABLE IF NOT EXISTS invite_labels (
    guild_id TEXT NOT NULL,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    channel_id TEXT,
    channel_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, code)
);

CREATE TABLE IF NOT EXISTS daily_invite_stats (
    guild_id TEXT NOT NULL,
    date TEXT NOT NULL,
    joins INTEGER DEFAULT 0,
    leaves INTEGER DEFAULT 0,
    fakes INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, date)
);

CREATE INDEX IF NOT EXISTS idx_invite_members_inviter ON invite_members (guild_id, inviter_id);
CREATE INDEX IF NOT EXISTS idx_invite_labels_guild ON invite_labels (guild_id);
