const { GlobalBanRemoteError } = require('../infrastructure/cloudflareGlobalBanClient');

class GlobalBanSyncService {
  constructor({ repository, client, logger = console, intervalSeconds = 30, onEvent = null }) {
    this.repository = repository;
    this.client = client;
    this.logger = logger || console;
    this.intervalMs = intervalSeconds * 1000;
    this.onEvent = onEvent;
    this.timer = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.syncOnce();
    this.timer = setInterval(() => this.syncOnce().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async syncOnce() {
    if (!this.client?.configured) {
      this.repository.setSyncAttempt({ status: 'disabled', errorCode: 'NOT_CONFIGURED' });
      return { status: 'disabled' };
    }
    if (this.syncing) return { status: 'already_running' };
    this.syncing = true;
    this.repository.setSyncAttempt({ status: 'syncing' });
    try {
      const state = this.repository.getSyncState();
      let cursor = Number(state.cursor || 0);
      if (!state.snapshot_completed_at) {
        const records = [];
        let snapshotCursor = null;
        let afterUserId = null;
        let hasMore = true;
        while (hasMore) {
          const page = await this.client.getSnapshotPage({ cursor: snapshotCursor, afterUserId });
          if (!Array.isArray(page.records)) throw new GlobalBanRemoteError('Snapshot records were invalid.', { code: 'INVALID_SNAPSHOT' });
          if (snapshotCursor === null) snapshotCursor = Number(page.snapshotCursor || 0);
          records.push(...page.records);
          hasMore = Boolean(page.hasMore);
          afterUserId = page.nextUserId || null;
          if (hasMore && !afterUserId) throw new GlobalBanRemoteError('Snapshot pagination did not provide a cursor.', { code: 'INVALID_SNAPSHOT' });
        }
        this.repository.replaceSnapshot(records, snapshotCursor || 0);
        cursor = snapshotCursor || 0;
        this.repository.setSyncSuccess({ cursor, snapshot: true });
      }

      let hasMore = true;
      while (hasMore) {
        const page = await this.client.getChanges({ afterEventId: cursor });
        if (!Array.isArray(page.events)) throw new GlobalBanRemoteError('Change events were invalid.', { code: 'INVALID_CHANGES' });
        for (const event of page.events) {
          const result = this.repository.applyEvent(event);
          if (result.applied) await this.onEvent?.(result, event);
        }
        const nextCursor = Number(page.nextCursor ?? cursor);
        if (nextCursor < cursor) throw new GlobalBanRemoteError('Change cursor moved backwards.', { code: 'CURSOR_REGRESSION' });
        cursor = nextCursor;
        hasMore = Boolean(page.hasMore);
        if (hasMore && cursor === Number(state.cursor || 0) && page.events.length === 0) throw new GlobalBanRemoteError('Change pagination made no progress.', { code: 'INVALID_CHANGES' });
      }
      this.repository.setSyncSuccess({ cursor });
      return { status: 'healthy', cursor };
    } catch (error) {
      const code = error.code || 'SYNC_ERROR';
      this.repository.setSyncFailure(code);
      this.logger.warn?.('global-bans', 'sync', 'Global-ban synchronization degraded.', { errorCode: code, retryable: error.retryable });
      return { status: 'degraded', errorCode: code };
    } finally {
      this.syncing = false;
    }
  }
}

module.exports = { GlobalBanSyncService };
