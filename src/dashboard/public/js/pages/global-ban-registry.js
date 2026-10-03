(function (global) {
  'use strict';

  const page = {
    csrfToken: null,
    cursor: '',
    editing: null,
    records: new Map(),
    pendingCursor: '',
    pendingRecords: new Map(),
    recommendationCursor: '',
    recommendationRecords: [],
    recommendationGuildId: '',
    recommendationRequestId: 0,

    async init() {
      global.Mochi?.onGuildChange?.((guildId) => this.loadRecommendations(true, guildId));
      try {
        this.csrfToken = (await apiFetch('/api/global-ban-registry/csrf')).token;
        await Promise.all([this.refreshSummary(), this.loadEntries(true), this.loadPending(true), this.loadEvents(), this.loadRecommendations(true)]);
      } catch (error) { this.showError(error); }
      document.getElementById('registry-refresh')?.addEventListener('click', () => this.refresh());
      document.getElementById('registry-recommendations-refresh')?.addEventListener('click', () => this.loadRecommendations(true));
      document.getElementById('registry-recommendations-next')?.addEventListener('click', () => this.loadRecommendations(false));
      document.getElementById('registry-filter')?.addEventListener('click', () => this.refreshLists());
      document.getElementById('registry-next')?.addEventListener('click', () => this.loadEntries(false));
      document.getElementById('registry-pending-next')?.addEventListener('click', () => this.loadPending(false));
      document.getElementById('registry-form')?.addEventListener('submit', (event) => this.save(event));
      document.getElementById('registry-cancel')?.addEventListener('click', () => this.resetForm());
      document.getElementById('registry-rows')?.addEventListener('click', (event) => this.handleAction(event));
      document.getElementById('registry-pending-rows')?.addEventListener('click', (event) => this.handleAction(event));
      document.getElementById('registry-recommendations')?.addEventListener('click', (event) => this.handleRecommendationAction(event));
    },

    async refresh() {
      try { await Promise.all([this.refreshSummary(), this.loadEntries(true), this.loadPending(true), this.loadEvents(), this.loadRecommendations(true)]); }
      catch (error) { this.showError(error); }
    },

    async refreshSummary() {
      const data = await apiFetch('/api/global-ban-registry/summary');
      const counts = data.counts || {};
      this.text('registry-total', data.total ?? 0);
      this.text('registry-pending', counts.pending ?? 0);
      this.text('registry-active', counts.active ?? 0);
      this.text('registry-status', 'Healthy');
    },

    async loadEntries(reset) {
      if (reset) { this.cursor = ''; this.records.clear(); }
      const search = document.getElementById('registry-search')?.value.trim() || '';
      const state = document.getElementById('registry-state')?.value || '';
      const params = new URLSearchParams({ limit: '50' });
      if (search) params.set('search', search);
      if (state) params.set('state', state);
      params.set('exclude_state', 'pending');
      if (this.cursor) params.set('cursor', this.cursor);
      const data = await apiFetch(`/api/global-ban-registry/bans?${params}`);
      for (const record of data.records || []) this.records.set(record.user_id, record);
      this.cursor = data.nextCursor || '';
      this.renderRows();
      const next = document.getElementById('registry-next');
      if (next) next.hidden = !data.hasMore;
    },

    async loadPending(reset) {
      if (reset) { this.pendingCursor = ''; this.pendingRecords.clear(); }
      const search = document.getElementById('registry-search')?.value.trim() || '';
      const params = new URLSearchParams({ limit: '50', state: 'pending' });
      if (search) params.set('search', search);
      if (this.pendingCursor) params.set('cursor', this.pendingCursor);
      try {
        const data = await apiFetch(`/api/global-ban-registry/bans?${params}`);
        for (const record of data.records || []) this.pendingRecords.set(record.user_id, record);
        this.pendingCursor = data.nextCursor || '';
        this.renderPendingRows();
        const next = document.getElementById('registry-pending-next');
        if (next) next.hidden = !data.hasMore;
      } catch (error) {
        this.pendingRecords.clear();
        this.pendingCursor = '';
        this.renderPendingRows('Unable to load pending requests.');
        throw error;
      }
    },

    async refreshLists() {
      try { await Promise.all([this.loadEntries(true), this.loadPending(true)]); }
      catch (error) { this.showError(error); }
    },

    async loadEvents() {
      const data = await apiFetch('/api/global-ban-registry/events?limit=30');
      const root = document.getElementById('registry-events');
      if (!root) return;
      root.replaceChildren();
      const events = data.events || [];
      if (!events.length) { root.textContent = 'No audit events yet.'; return; }
      for (const event of events) {
        const row = document.createElement('div');
        row.className = 'honeypot-kick-row';
        const identity = document.createElement('div');
        identity.className = 'honeypot-kick-identity';
        const title = document.createElement('strong');
        title.textContent = `${event.action} · ${event.user_id}`;
        const details = document.createElement('span');
        details.textContent = `Operator ${event.actor_id || 'unknown'} · version ${event.record_version}`;
        identity.append(title, details);
        const time = document.createElement('span');
        time.className = 'honeypot-kick-time';
        time.textContent = event.created_at || '';
        row.append(identity, time);
        root.appendChild(row);
      }
    },

    async loadRecommendations(reset = true, guildId = global.Mochi?.currentGuildId) {
      if (reset) {
        this.recommendationCursor = '';
        this.recommendationRecords = [];
        this.recommendationGuildId = guildId || '';
      }
      const activeGuildId = guildId || this.recommendationGuildId || global.Mochi?.currentGuildId || '';
      if (!activeGuildId) {
        this.renderRecommendations({ guild: null, recommendations: [], registryAvailable: true, hasMore: false });
        return;
      }
      if (reset) this.recommendationGuildId = activeGuildId;
      const requestId = ++this.recommendationRequestId;
      const params = new URLSearchParams({ limit: '25' });
      if (this.recommendationCursor) params.set('after', this.recommendationCursor);
      try {
        const data = await apiFetch(`/api/global-ban-registry/guilds/${encodeURIComponent(activeGuildId)}/recommendations?${params}`);
        if (requestId !== this.recommendationRequestId || activeGuildId !== this.recommendationGuildId) return;
        this.recommendationRecords = reset
          ? (data.recommendations || [])
          : this.recommendationRecords.concat(data.recommendations || []);
        this.recommendationCursor = data.nextCursor || '';
        this.renderRecommendations(data);
      } catch (error) {
        if (requestId !== this.recommendationRequestId) return;
        this.recommendationRecords = [];
        this.recommendationCursor = '';
        this.renderRecommendations({ guild: null, recommendations: [], registryAvailable: false, error: error?.message || 'Unable to load recommendations.' });
        window.Mochi?.showToast(error?.message || 'Unable to load server recommendations.', 'leave');
      }
    },

    renderRecommendations(data = {}) {
      const root = document.getElementById('registry-recommendations');
      const status = document.getElementById('registry-recommendations-status');
      const next = document.getElementById('registry-recommendations-next');
      if (!root) return;
      const guildName = data.guild?.name || 'selected server';
      if (status) {
        status.textContent = data.error
          ? data.error
          : data.registryAvailable === false
            ? `Could not verify the global registry for ${guildName}; suggestions are disabled.`
            : `Local Discord bans from ${guildName}. Suggestions only pre-fill a proposal.`;
      }
      root.replaceChildren();
      const recommendations = this.recommendationRecords;
      if (!recommendations.length) {
        const empty = document.createElement('div');
        empty.className = 'loading-row';
        empty.textContent = data.error ? 'Recommendations unavailable.' : 'No local bans found.';
        root.appendChild(empty);
      } else {
        for (const recommendation of recommendations) root.appendChild(this.recommendationCard(recommendation));
      }
      if (next) next.hidden = !(data.hasMore && this.recommendationCursor);
    },

    recommendationCard(recommendation) {
      const card = document.createElement('article');
      card.className = 'registry-recommendation-card';
      const header = document.createElement('div');
      header.className = 'registry-recommendation-header';
      if (recommendation.avatarUrl) {
        const avatar = document.createElement('img');
        avatar.className = 'registry-recommendation-avatar';
        avatar.src = recommendation.avatarUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        header.appendChild(avatar);
      }
      const identity = document.createElement('div');
      identity.className = 'registry-recommendation-identity';
      const name = document.createElement('strong');
      name.textContent = recommendation.globalName || recommendation.username || recommendation.userId;
      const id = document.createElement('span');
      id.textContent = recommendation.userId;
      identity.append(name, id);
      header.appendChild(identity);
      card.appendChild(header);
      if (recommendation.reason) {
        const reason = document.createElement('p');
        reason.className = 'registry-recommendation-reason';
        reason.textContent = recommendation.reason;
        card.appendChild(reason);
      }
      const footer = document.createElement('div');
      footer.className = 'registry-recommendation-footer';
      const state = document.createElement('span');
      state.className = `registry-recommendation-state ${recommendation.eligible ? 'is-eligible' : ''}`;
      state.textContent = recommendation.eligible
        ? 'Not in global registry'
        : recommendation.registryState
          ? `Global entry: ${recommendation.registryState}`
          : 'Registry check unavailable';
      footer.appendChild(state);
      if (recommendation.eligible) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'button button-primary button-small';
        action.dataset.recommendationAction = 'use';
        action.dataset.userId = recommendation.userId;
        action.textContent = 'Use suggestion';
        footer.appendChild(action);
      }
      card.appendChild(footer);
      return card;
    },

    handleRecommendationAction(event) {
      const button = event.target.closest('button[data-recommendation-action="use"]');
      if (!button) return;
      const recommendation = this.recommendationRecords.find((item) => item.userId === button.dataset.userId);
      if (recommendation) this.prefillFromRecommendation(recommendation);
    },

    prefillFromRecommendation(recommendation) {
      this.resetForm();
      this.value('registry-user-id', recommendation.userId);
      this.value('registry-reason-code', 'local_ban_review');
      const publicReason = String(recommendation.reason || '').trim();
      this.value('registry-public-reason', (publicReason.length >= 3 ? publicReason : 'Local Discord ban review.').slice(0, 500));
      this.value('registry-evidence', `Local ban in ${this.recommendationGuildId || 'selected server'}`);
      const user = document.getElementById('registry-user-id');
      if (user) { user.readOnly = false; user.focus(); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.Mochi?.showToast('Suggestion copied into the proposal form.', 'success');
    },

    renderRows() {
      this.renderRecordRows('registry-rows', this.records, 'No matching registry entries.');
    },

    renderPendingRows(emptyText = 'No pending requests.') {
      this.renderRecordRows('registry-pending-rows', this.pendingRecords, emptyText);
    },

    renderRecordRows(rootId, records, emptyText) {
      const root = document.getElementById(rootId);
      if (!root) return;
      root.replaceChildren();
      const stateOrder = { pending: 0, active: 1, revoked: 2, rejected: 3, expired: 4 };
      const values = [...records.values()].sort((a, b) => {
        const stateDifference = (stateOrder[a.state] ?? 99) - (stateOrder[b.state] ?? 99);
        if (stateDifference) return stateDifference;
        const updatedDifference = String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
        return updatedDifference || String(b.user_id || '').localeCompare(String(a.user_id || ''));
      });
      if (!values.length) {
        const row = document.createElement('tr'); const cell = document.createElement('td');
        cell.colSpan = 6; cell.className = 'loading-row'; cell.textContent = emptyText; row.appendChild(cell); root.appendChild(row); return;
      }
      for (const record of values) {
        const row = document.createElement('tr');
        row.appendChild(this.memberCell(record));
        for (const value of [record.state, record.severity || '—', record.public_reason || '—', record.updated_at || '—']) {
          const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
        }
        const actions = document.createElement('td'); actions.className = 'page-actions';
        const edit = this.button('Edit', 'edit', record.user_id);
        actions.appendChild(edit);
        if (record.state === 'pending') {
          actions.append(this.button('Activate', 'activate', record.user_id), this.button('Reject', 'reject', record.user_id));
        } else if (record.state === 'active') actions.appendChild(this.button('Revoke', 'revoke', record.user_id));
        else if (['revoked', 'rejected', 'expired'].includes(record.state)) actions.appendChild(this.button('Reopen', 'reopen', record.user_id));
        row.appendChild(actions); root.appendChild(row);
      }
    },

    memberCell(record) {
      const cell = document.createElement('td');
      const identity = document.createElement('div');
      identity.className = 'registry-entry-identity';
      const avatar = document.createElement('img');
      avatar.className = 'user-cell-avatar';
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.src = record.avatar || global.MochiConstants?.discord?.defaultAvatar || '';
      const fallback = global.MochiConstants?.discord?.defaultAvatar;
      if (fallback) avatar.addEventListener('error', () => { if (avatar.src !== fallback) avatar.src = fallback; }, { once: true });
      const details = document.createElement('div');
      details.className = 'registry-entry-details';
      const username = document.createElement('strong');
      username.textContent = record.username || 'Unknown user';
      const userId = document.createElement('span');
      userId.textContent = record.user_id;
      details.append(username, userId);
      identity.append(avatar, details);
      cell.appendChild(identity);
      return cell;
    },

    button(label, action, userId) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'button button-secondary'; button.dataset.action = action; button.dataset.userId = userId; button.textContent = label;
      return button;
    },

    handleAction(event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const record = this.records.get(button.dataset.userId) || this.pendingRecords.get(button.dataset.userId);
      if (!record) return;
      if (button.dataset.action === 'edit') return this.editRecord(record);
      this.mutate(button.dataset.action, record);
    },

    editRecord(record) {
      this.editing = record;
      this.value('registry-editing-user', record.user_id); this.value('registry-editing-version', record.version);
      this.value('registry-user-id', record.user_id); this.value('registry-reason-code', record.reason_code || ''); this.value('registry-severity', record.severity || ''); this.value('registry-public-reason', record.public_reason || ''); this.value('registry-evidence', record.evidence_reference || '');
      const expires = record.expires_at ? new Date(record.expires_at) : null;
      this.value('registry-expires', expires && !Number.isNaN(expires.getTime()) ? new Date(expires.getTime() - expires.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
      this.text('registry-submit', 'Save changes');
      const user = document.getElementById('registry-user-id'); user.readOnly = true;
      const cancel = document.getElementById('registry-cancel'); if (cancel) cancel.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    async save(event) {
      event.preventDefault();
      const userId = document.getElementById('registry-user-id').value.trim();
      const body = { userId, reasonCode: document.getElementById('registry-reason-code').value.trim(), severity: document.getElementById('registry-severity').value || null, publicReason: document.getElementById('registry-public-reason').value.trim(), evidenceReference: document.getElementById('registry-evidence').value.trim() || null, expiresAt: this.isoDate(document.getElementById('registry-expires').value) };
      try {
        if (this.editing) {
          body.expectedVersion = Number(this.editing.version);
          await this.mutateRequest(`/api/global-ban-registry/bans/${encodeURIComponent(userId)}`, 'PATCH', body);
        } else await this.mutateRequest('/api/global-ban-registry/bans', 'POST', body);
        this.resetForm(); await this.refresh(); window.Mochi?.showToast('Registry entry saved.', 'success');
      } catch (error) { this.showError(error); }
    },

    async mutate(action, record) {
      const labels = { activate: 'activate this entry globally', reject: 'reject this proposal', revoke: 'revoke this global entry', reopen: 'reopen this entry' };
      if (!window.confirm(`Are you sure you want to ${labels[action]} for ${record.user_id}?`)) return;
      try {
        await this.mutateRequest(`/api/global-ban-registry/bans/${encodeURIComponent(record.user_id)}/${action}`, 'POST', { expectedVersion: Number(record.version) });
        await this.refresh(); window.Mochi?.showToast('Registry action completed.', 'success');
      } catch (error) { this.showError(error); }
    },

    mutateRequest(url, method, body) { return apiFetch(url, { method, headers: { 'X-CSRF-Token': this.csrfToken }, body }); },
    isoDate(value) { return value ? new Date(value).toISOString() : null; },
    resetForm() { this.editing = null; document.getElementById('registry-form')?.reset(); document.getElementById('registry-user-id').readOnly = false; const cancel = document.getElementById('registry-cancel'); if (cancel) cancel.hidden = true; this.text('registry-submit', 'Propose entry'); },
    value(id, value) { const element = document.getElementById(id); if (element) element.value = value ?? ''; },
    text(id, value) { const element = document.getElementById(id); if (element) element.textContent = value ?? ''; },
    showError(error) { window.Mochi?.showToast(error?.message || 'Registry request failed.', 'leave'); this.text('registry-status', 'Error'); },
  };

  global.globalBanRegistryPage = page;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => page.init());
  else page.init();
})(typeof window !== 'undefined' ? window : globalThis);
