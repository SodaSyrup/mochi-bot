class GlobalBanRemoteError extends Error {
  constructor(message, { status = 0, code = 'REMOTE_ERROR', retryable = false } = {}) {
    super(message);
    this.name = 'GlobalBanRemoteError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

class CloudflareGlobalBanClient {
  constructor({ baseUrl, token, timeoutMs = 5000, fetchImpl = globalThis.fetch, logger = console }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger || console;
  }

  get configured() {
    return Boolean(this.baseUrl && this.token && typeof this.fetchImpl === 'function');
  }

  async #request(path, { method = 'GET', body } = {}) {
    if (!this.configured) throw new GlobalBanRemoteError('Global-ban API is not configured.', { code: 'NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* normalized below */ }
      if (!response.ok) {
        const status = response.status;
        throw new GlobalBanRemoteError(payload?.error?.message || `Global-ban API returned ${status}.`, {
          status,
          code: payload?.error?.code || (status === 401 || status === 403 ? 'AUTH_FAILED' : `HTTP_${status}`),
          retryable: status === 408 || status === 425 || status === 429 || status >= 500,
        });
      }
      if (!payload || typeof payload !== 'object') throw new GlobalBanRemoteError('Global-ban API returned invalid JSON.', { code: 'INVALID_RESPONSE' });
      return payload;
    } catch (error) {
      if (error instanceof GlobalBanRemoteError) throw error;
      throw new GlobalBanRemoteError(error.name === 'AbortError' ? 'Global-ban API request timed out.' : 'Global-ban API request failed.', {
        code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  getSnapshotPage({ cursor = null, afterUserId = null, limit = 500 } = {}) {
    const params = new URLSearchParams();
    if (cursor !== null && cursor !== undefined) params.set('snapshot_cursor', String(cursor));
    if (afterUserId) params.set('after_user_id', String(afterUserId));
    params.set('limit', String(Math.min(Math.max(Number(limit) || 500, 1), 1000)));
    return this.#request(`/v1/snapshot?${params}`);
  }

  getChanges({ afterEventId = 0, limit = 500 } = {}) {
    const params = new URLSearchParams({ after_event_id: String(Number(afterEventId) || 0), limit: String(Math.min(Math.max(Number(limit) || 500, 1), 1000)) });
    return this.#request(`/v1/changes?${params}`);
  }

  getStatus() {
    return this.#request('/v1/status');
  }
}

module.exports = { CloudflareGlobalBanClient, GlobalBanRemoteError };
