(function () {
  class GlobalBansPage {
    constructor() {
      this.guildId = null;
      this.data = null;
      window.Mochi?.onGuildChange((guildId) => { this.guildId = guildId; this.refresh(); });
      window.Mochi?.onRealtime('globalBanEnforcement', (event) => { if (event.guildId === this.guildId) this.refresh(); });
    }

    async refresh() {
      if (!this.guildId) return;
      try {
        this.data = await apiFetch(`/api/guilds/${this.guildId}/global-bans`);
        this.render();
      } catch (error) { window.Mochi?.showToast(`Could not load global protection: ${error.message}`, 'leave'); }
    }

    async save(event) {
      event.preventDefault();
      const mode = document.getElementById('global-bans-mode-select').value;
      if (mode === 'enforce' && !window.confirm('Enable permanent global-ban enforcement for this server?')) return;
      try {
        await apiFetch(`/api/guilds/${this.guildId}/global-bans/settings`, { method: 'PATCH', body: { mode, logChannelId: document.getElementById('global-bans-channel').value || null, deleteMessageSeconds: Number(document.getElementById('global-bans-delete').value || 0) } });
        window.Mochi?.showToast('Global protection settings saved.', 'success');
        await this.refresh();
      } catch (error) { window.Mochi?.showToast(`Could not save settings: ${error.message}`, 'leave'); }
    }

    async addExemption(event) {
      event.preventDefault();
      try {
        await apiFetch(`/api/guilds/${this.guildId}/global-bans/exemptions`, { method: 'POST', body: { userId: document.getElementById('global-bans-user-id').value, reason: document.getElementById('global-bans-reason').value } });
        event.target.reset(); await this.refresh();
      } catch (error) { window.Mochi?.showToast(`Could not add exemption: ${error.message}`, 'leave'); }
    }

    async removeExemption(userId) {
      await apiFetch(`/api/guilds/${this.guildId}/global-bans/exemptions/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      await this.refresh();
    }

    async reconcile() {
      try { const result = await apiFetch(`/api/guilds/${this.guildId}/global-bans/reconcile`, { method: 'POST' }); window.Mochi?.showToast(`Queued ${result.queued} enforcement jobs.`, 'success'); await this.refresh(); } catch (error) { window.Mochi?.showToast(`Could not queue reconciliation: ${error.message}`, 'leave'); }
    }

    render() {
      const d = this.data || {}; const settings = d.settings || {}; const sync = d.sync || {};
      this.text('global-bans-mode', settings.mode || 'disabled'); this.text('global-bans-count', d.activeCount ?? '—');
      this.text('global-bans-sync', sync.status === 'healthy' && sync.cacheFresh ? 'Healthy' : (sync.status || 'Not synced'));
      const queued = (d.jobStats || []).filter((x) => ['pending', 'running', 'failed'].includes(x.status)).reduce((sum, x) => sum + Number(x.count || 0), 0); this.text('global-bans-jobs', queued);
      const mode = document.getElementById('global-bans-mode-select'); if (mode) mode.value = settings.mode || 'disabled';
      const channel = document.getElementById('global-bans-channel'); if (channel) { const selected = settings.log_channel_id || ''; channel.innerHTML = '<option value="">No alert channel</option>' + (d.channels || []).filter((c) => c.type === 0 || c.type === 5).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`).join(''); channel.value = selected; }
      this.renderExemptions(d.exemptions || []); this.renderEvents(d.recentEvents || []);
    }

    renderExemptions(rows) { const root = document.getElementById('global-bans-exemptions'); if (!root) return; root.innerHTML = rows.length ? rows.map((row) => `<div class="honeypot-kick-row"><div class="honeypot-kick-identity"><strong>${escapeHtml(row.user_id)}</strong><span>${escapeHtml(row.reason)}</span></div><button class="button button-danger" onclick="globalBansPage.removeExemption('${escapeHtml(row.user_id)}')">Remove</button></div>`).join('') : '<div class="loading-row">No local exemptions.</div>'; }
    renderEvents(rows) { const root = document.getElementById('global-bans-events'); if (!root) return; root.innerHTML = rows.length ? rows.map((row) => `<div class="honeypot-kick-row"><div class="honeypot-kick-identity"><strong>${escapeHtml(row.user_id)}</strong><span>${escapeHtml(row.outcome)} · ${escapeHtml(row.details_code || '')}</span></div><span class="honeypot-kick-time">${escapeHtml(row.occurred_at || '')}</span></div>`).join('') : '<div class="loading-row">No recent enforcement activity.</div>'; }
    text(id, value) { const node = document.getElementById(id); if (node) node.textContent = String(value); }
  }
  window.globalBansPage = new GlobalBansPage();
})();
