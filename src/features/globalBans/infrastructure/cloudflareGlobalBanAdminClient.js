const { GlobalBanRemoteError } = require('./cloudflareGlobalBanClient');

class CloudflareGlobalBanAdminClient {
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

  async request(path, { method = 'GET', body = undefined, operatorId = null, idempotencyKey = null } = {}) {
    if (!this.configured) throw new GlobalBanRemoteError('Global-ban admin API is not configured.', { code: 'NOT_CONFIGURED' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (operatorId) headers['X-Operator-Id'] = String(operatorId);
      if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* normalized below */ }
      if (!response.ok) {
        throw new GlobalBanRemoteError(payload?.error?.message || `Global-ban admin API returned ${response.status}.`, {
          status: response.status,
          code: payload?.error?.code || `HTTP_${response.status}`,
          retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
        });
      }
      if (!payload || typeof payload !== 'object') throw new GlobalBanRemoteError('Global-ban admin API returned invalid JSON.', { code: 'INVALID_RESPONSE' });
      return payload;
    } catch (error) {
      if (error instanceof GlobalBanRemoteError) throw error;
      throw new GlobalBanRemoteError(error.name === 'AbortError' ? 'Global-ban admin API request timed out.' : 'Global-ban admin API request failed.', {
        code: error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  getSummary() { return this.request('/v1/admin/summary'); }

  getBans({ state = '', excludeState = '', search = '', cursor = '', limit = 50 } = {}) {
    const params = new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 50, 1), 100)) });
    if (state) params.set('state', state);
    if (excludeState) params.set('exclude_state', excludeState);
    if (search) params.set('search', search);
    if (cursor) params.set('cursor', cursor);
    return this.request(`/v1/admin/bans?${params}`);
  }

  getBan(userId) { return this.request(`/v1/admin/bans/${encodeURIComponent(String(userId))}`); }

  getEvents({ limit = 100, cursor = '' } = {}) {
    const params = new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 100, 1), 500)) });
    if (cursor) params.set('cursor', cursor);
    return this.request(`/v1/admin/events?${params}`);
  }

  createBan(payload, operatorId, idempotencyKey = crypto.randomUUID()) {
    return this.request('/v1/admin/bans', { method: 'POST', body: payload, operatorId, idempotencyKey });
  }

  updateBan(userId, payload, operatorId, idempotencyKey = crypto.randomUUID()) {
    return this.request(`/v1/admin/bans/${encodeURIComponent(String(userId))}`, { method: 'PATCH', body: payload, operatorId, idempotencyKey });
  }

  activateBan(userId, payload = {}, operatorId, idempotencyKey = crypto.randomUUID()) {
    return this.request(`/v1/admin/bans/${encodeURIComponent(String(userId))}/activate`, { method: 'POST', body: payload, operatorId, idempotencyKey });
  }

  rejectBan(userId, payload = {}, operatorId, idempotencyKey = crypto.randomUUID()) {
    return this.request(`/v1/admin/bans/${encodeURIComponent(String(userId))}/reject`, { method: 'POST', body: payload, operatorId, idempotencyKey });
  }

  revokeBan(userId, payload = {}, operatorId, idempotencyKey = crypto.randomUUID()) {
    return this.request(`/v1/admin/bans/${encodeURIComponent(String(userId))}/revoke`, { method: 'POST', body: payload, operatorId, idempotencyKey });
  }

  reopenBan(userId, payload = {}, operatorId, idempotencyKey = crypto.randomUUID()) {
    return this.request(`/v1/admin/bans/${encodeURIComponent(String(userId))}/reopen`, { method: 'POST', body: payload, operatorId, idempotencyKey });
  }
}

module.exports = { CloudflareGlobalBanAdminClient };
