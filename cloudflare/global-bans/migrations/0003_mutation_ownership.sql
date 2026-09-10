ALTER TABLE global_bans ADD COLUMN last_mutation_token TEXT;
ALTER TABLE global_ban_events ADD COLUMN request_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_global_ban_events_idempotency ON global_ban_events (idempotency_key);
