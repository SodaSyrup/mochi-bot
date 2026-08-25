const { MODES, isValidMode, normalizeUserId } = require('../domain/globalBanPolicy');

class GlobalBanRepository {
  constructor(db) {
    this.db = db;
    this.ensureSchema();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS global_ban_cache (
        user_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        severity TEXT,
        reason_code TEXT,
        public_reason TEXT,
        activated_at TEXT,
        expires_at TEXT,
        last_event_id INTEGER NOT NULL DEFAULT 0,
        record_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_global_ban_cache_state ON global_ban_cache (state);
      CREATE INDEX IF NOT EXISTS idx_global_ban_cache_event ON global_ban_cache (last_event_id);
      CREATE TABLE IF NOT EXISTS global_ban_sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_success_at TEXT,
        snapshot_completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'never_synced',
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT
      );
      INSERT OR IGNORE INTO global_ban_sync_state (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS guild_global_ban_settings (
        guild_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'disabled' CHECK (mode IN ('disabled', 'alert', 'enforce')),
        log_channel_id TEXT,
        delete_message_seconds INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS global_ban_exemptions (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_global_ban_exemptions_user ON global_ban_exemptions (user_id);
      CREATE TABLE IF NOT EXISTS global_ban_enforcement_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        source_event_id INTEGER NOT NULL DEFAULT 0,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        outcome_code TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (guild_id, user_id, source_event_id, action)
      );
      CREATE INDEX IF NOT EXISTS idx_global_ban_jobs_due ON global_ban_enforcement_jobs (status, next_attempt_at);
      CREATE TABLE IF NOT EXISTS global_ban_enforcement_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        source_event_id INTEGER NOT NULL DEFAULT 0,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        details_code TEXT,
        occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  getCache(userId) {
    const id = normalizeUserId(userId);
    return id ? this.db.prepare('SELECT * FROM global_ban_cache WHERE user_id = ?').get(id) || null : null;
  }

  listActiveCache() {
    return this.db.prepare("SELECT * FROM global_ban_cache WHERE state = 'active' ORDER BY user_id").all();
  }

  getSyncState() {
    return this.db.prepare('SELECT * FROM global_ban_sync_state WHERE id = 1').get();
  }

  setSyncAttempt({ status = 'syncing', errorCode = null } = {}) {
    this.db.prepare(`
      UPDATE global_ban_sync_state
      SET last_attempt_at = CURRENT_TIMESTAMP, status = ?, last_error_code = ?
      WHERE id = 1
    `).run(status, errorCode);
  }

  setSyncSuccess({ cursor, snapshot = false }) {
    this.db.prepare(`
      UPDATE global_ban_sync_state
      SET cursor = ?, last_success_at = CURRENT_TIMESTAMP,
          snapshot_completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE snapshot_completed_at END,
          status = 'healthy', consecutive_failures = 0, last_error_code = NULL
      WHERE id = 1
    `).run(Number(cursor) || 0, snapshot ? 1 : 0);
  }

  setSyncFailure(errorCode) {
    this.db.prepare(`
      UPDATE global_ban_sync_state
      SET status = 'degraded', consecutive_failures = consecutive_failures + 1, last_error_code = ?
      WHERE id = 1
    `).run(String(errorCode || 'unknown').slice(0, 120));
  }

  replaceSnapshot(records, cursor) {
    const tx = this.db.transaction(() => {
      const seen = new Set();
      const upsert = this.db.prepare(`
        INSERT INTO global_ban_cache
          (user_id, state, severity, reason_code, public_reason, activated_at, expires_at, last_event_id, record_version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          state = excluded.state, severity = excluded.severity, reason_code = excluded.reason_code,
          public_reason = excluded.public_reason, activated_at = excluded.activated_at,
          expires_at = excluded.expires_at, last_event_id = excluded.last_event_id,
          record_version = excluded.record_version, updated_at = CURRENT_TIMESTAMP
      `);
      for (const record of records || []) {
        const id = normalizeUserId(record.user_id || record.userId);
        if (!id) continue;
        seen.add(id);
        upsert.run(id, record.state || 'active', record.severity || null, record.reason_code || record.reasonCode || null,
          record.public_reason || record.publicReason || null, record.activated_at || record.activatedAt || null,
          record.expires_at || record.expiresAt || null, Number(record.last_event_id || record.eventId || 0),
          Number(record.record_version || record.version || 1));
      }
      // Rows omitted from a complete snapshot are no longer present in the
      // authoritative active set. Keep their audit state, but mark inactive.
      if (seen.size === 0 && (records || []).length === 0) {
        this.db.prepare("UPDATE global_ban_cache SET state = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE state = 'active'").run();
      } else if (seen.size > 0) {
        const active = this.db.prepare("SELECT user_id FROM global_ban_cache WHERE state = 'active'").all();
        const remove = active.filter((row) => !seen.has(row.user_id)).map((row) => row.user_id);
        const mark = this.db.prepare("UPDATE global_ban_cache SET state = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND state = 'active'");
        for (const id of remove) mark.run(id);
      }
      this.db.prepare('UPDATE global_ban_sync_state SET cursor = ?, snapshot_completed_at = CURRENT_TIMESTAMP WHERE id = 1').run(Number(cursor) || 0);
    });
    tx();
  }

  applyEvent(event) {
    const eventId = Number(event.event_id || event.eventId || 0);
    const payload = event.record_payload || event.record || event.payload || event;
    const id = normalizeUserId(event.user_id || event.userId || payload.user_id || payload.userId);
    if (!id) return { applied: false, reason: 'invalid_user_id' };
    const state = this.getSyncState();
    if (eventId && eventId <= Number(state.cursor || 0)) return { applied: false, reason: 'already_applied' };
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO global_ban_cache
          (user_id, state, severity, reason_code, public_reason, activated_at, expires_at, last_event_id, record_version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          state = excluded.state, severity = excluded.severity, reason_code = excluded.reason_code,
          public_reason = excluded.public_reason, activated_at = excluded.activated_at,
          expires_at = excluded.expires_at, last_event_id = excluded.last_event_id,
          record_version = excluded.record_version, updated_at = CURRENT_TIMESTAMP
      `).run(id, payload.state || (event.action === 'revoked' ? 'revoked' : 'active'), payload.severity || null,
        payload.reason_code || payload.reasonCode || null, payload.public_reason || payload.publicReason || null,
        payload.activated_at || payload.activatedAt || null, payload.expires_at || payload.expiresAt || null,
        eventId, Number(payload.record_version || payload.version || 1));
      if (eventId) this.db.prepare('UPDATE global_ban_sync_state SET cursor = ? WHERE id = 1').run(eventId);
    });
    tx();
    return { applied: true, userId: id, state: this.getCache(id) };
  }

  getGuildSettings(guildId) {
    const row = this.db.prepare('SELECT * FROM guild_global_ban_settings WHERE guild_id = ?').get(guildId);
    return row || { guild_id: guildId, mode: 'disabled', log_channel_id: null, delete_message_seconds: 0, updated_by: null, updated_at: null };
  }

  setGuildSettings(guildId, { mode, logChannelId, deleteMessageSeconds, updatedBy } = {}) {
    if (!isValidMode(mode)) throw new Error(`Invalid global-ban mode: ${mode}`);
    const seconds = Number.isInteger(deleteMessageSeconds) ? Math.max(0, Math.min(deleteMessageSeconds, 7 * 24 * 60 * 60)) : 0;
    this.db.prepare(`
      INSERT INTO guild_global_ban_settings (guild_id, mode, log_channel_id, delete_message_seconds, updated_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET mode = excluded.mode, log_channel_id = excluded.log_channel_id,
        delete_message_seconds = excluded.delete_message_seconds, updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(guildId, mode, logChannelId || null, seconds, updatedBy || null);
    return this.getGuildSettings(guildId);
  }

  listExemptions(guildId) {
    return this.db.prepare('SELECT * FROM global_ban_exemptions WHERE guild_id = ? ORDER BY created_at DESC').all(guildId);
  }

  getExemption(guildId, userId) {
    return this.db.prepare('SELECT * FROM global_ban_exemptions WHERE guild_id = ? AND user_id = ?').get(guildId, userId) || null;
  }

  setExemption(guildId, userId, { reason, createdBy, expiresAt = null }) {
    this.db.prepare(`
      INSERT INTO global_ban_exemptions (guild_id, user_id, reason, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason,
        created_by = excluded.created_by, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP
    `).run(guildId, userId, reason, createdBy || null, expiresAt);
    return this.getExemption(guildId, userId);
  }

  deleteExemption(guildId, userId) {
    this.db.prepare('DELETE FROM global_ban_exemptions WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  }

  enqueue({ guildId, userId, sourceEventId = 0, action = 'ban' }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO global_ban_enforcement_jobs (guild_id, user_id, source_event_id, action)
      VALUES (?, ?, ?, ?)
    `).run(guildId, userId, Number(sourceEventId) || 0, action);
  }

  enqueueForGuild(guildId, sourceEventId = 0) {
    const records = this.listActiveCache();
    const tx = this.db.transaction(() => {
      for (const record of records) this.enqueue({ guildId, userId: record.user_id, sourceEventId: sourceEventId || record.last_event_id, action: 'ban' });
    });
    tx();
    return records.length;
  }

  cancelForUser(userId, guildId = null) {
    const query = guildId
      ? "UPDATE global_ban_enforcement_jobs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND guild_id = ? AND status IN ('pending', 'failed', 'running')"
      : "UPDATE global_ban_enforcement_jobs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status IN ('pending', 'failed', 'running')";
    return guildId ? this.db.prepare(query).run(userId, guildId) : this.db.prepare(query).run(userId);
  }

  claimDueJobs(limit = 20) {
    const rows = this.db.prepare(`
      SELECT * FROM global_ban_enforcement_jobs
      WHERE status IN ('pending', 'failed') AND datetime(next_attempt_at) <= datetime('now')
      ORDER BY id LIMIT ?
    `).all(limit);
    const tx = this.db.transaction(() => {
      const update = this.db.prepare("UPDATE global_ban_enforcement_jobs SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'failed')");
      return rows.filter((row) => update.run(row.id).changes > 0).map((row) => ({ ...row, status: 'running', attempts: row.attempts + 1 }));
    });
    return tx();
  }

  completeJob(job, { outcome, detailsCode = null, retry = false, errorCode = null, retryAfterSeconds = 30 } = {}) {
    const status = retry ? 'failed' : (outcome === 'cancelled' || outcome === 'skipped' ? 'skipped' : 'succeeded');
    const next = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE global_ban_enforcement_jobs SET status = ?, outcome_code = ?, last_error_code = ?,
          next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(status, outcome || null, errorCode || null, next, job.id);
      this.db.prepare(`
        INSERT INTO global_ban_enforcement_events (job_id, guild_id, user_id, source_event_id, action, outcome, details_code)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(job.id, job.guild_id, job.user_id, job.source_event_id, job.action, outcome || status, detailsCode);
    })();
  }

  recordEnforcementEvent({ jobId = null, guildId, userId, sourceEventId = 0, action, outcome, detailsCode = null } = {}) {
    this.db.prepare(`
      INSERT INTO global_ban_enforcement_events (job_id, guild_id, user_id, source_event_id, action, outcome, details_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, guildId, userId, Number(sourceEventId) || 0, action || 'ban', outcome || 'unknown', detailsCode);
  }

  getRecentEvents(guildId, limit = 25) {
    return this.db.prepare('SELECT * FROM global_ban_enforcement_events WHERE guild_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?').all(guildId, limit);
  }

  getJobStats(guildId = null) {
    const where = guildId ? 'WHERE guild_id = ?' : '';
    const params = guildId ? [guildId] : [];
    return this.db.prepare(`SELECT status, COUNT(*) AS count FROM global_ban_enforcement_jobs ${where} GROUP BY status`).all(...params);
  }

  forgetGuild(guildId) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM global_ban_exemptions WHERE guild_id = ?').run(guildId);
      this.db.prepare('DELETE FROM guild_global_ban_settings WHERE guild_id = ?').run(guildId);
      this.db.prepare('DELETE FROM global_ban_enforcement_jobs WHERE guild_id = ?').run(guildId);
      this.db.prepare('DELETE FROM global_ban_enforcement_events WHERE guild_id = ?').run(guildId);
    })();
  }
}

module.exports = { GlobalBanRepository, MODES };
