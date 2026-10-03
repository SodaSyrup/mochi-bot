/**
 * Settings Page Script
 */

class SettingsPage {
  constructor() {
    this.guildId = null;
    // Monotonic token so a slow async response for guild A is never applied
    // after the user has switched to guild B.
    this.loadToken = 0;
    this.importPreview = null;
    this.importBusy = false;
    this.importRequest = 0;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    document.getElementById('invite-import-form')?.addEventListener('input', () => this.clearInviteImport());
    if (window.Mochi) {
      window.Mochi.onGuildChange((guildId) => this.onGuildChange(guildId));
    }
  }

  getGuildId() {
    return this.guildId;
  }

  async onGuildChange(guildId) {
    this.guildId = guildId;
    const token = (this.loadToken += 1);
    this.importRequest += 1;
    this.importBusy = false;
    this.clearInviteImport();
    const importChannel = document.getElementById('setting-import-channel');
    if (importChannel) importChannel.replaceChildren();
    const importBtn = document.getElementById('btn-preview-invite-import');
    if (importBtn) importBtn.disabled = !guildId;

    const select = document.getElementById('setting-invite-log-channel');
    const saveBtn = document.getElementById('btn-save-invite-log');
    this.setControlsEnabled(false, select, saveBtn);

    if (!guildId) return;

    try {
      const [guildData, channelsData] = await Promise.all([
        apiFetch(`/api/guilds/${guildId}`),
        apiFetch(`/api/guilds/${guildId}/channels`),
      ]);
      if (token !== this.loadToken) return; // stale guild result

      const configured = guildData.settings?.invite_log_channel_id || '';
      this.populateChannelSelect(select, channelsData.channels || [], configured);
      this.populateChannelSelect(importChannel, channelsData.channels || [], '');
      if (importChannel?.firstChild) importChannel.firstChild.textContent = 'Use saved invite log channel';
    } catch (err) {
      console.error('[Settings] Error loading invite log channels:', err);
      if (window.Mochi) {
        window.Mochi.showToast('Could not load invite log channels.', 'leave');
      }
    } finally {
      if (token === this.loadToken) {
        this.setControlsEnabled(true, select, saveBtn);
      }
    }
  }

  /**
   * Build the channel dropdown with safe DOM APIs only — Discord-controlled
   * channel names must never be inserted as HTML.
   */
  populateChannelSelect(select, channels, configured) {
    if (!select) return;

    select.textContent = '';
    const disabledOption = document.createElement('option');
    disabledOption.value = '';
    disabledOption.textContent = 'Disabled';
    select.appendChild(disabledOption);

    for (const channel of channels || []) {
      const opt = document.createElement('option');
      opt.value = channel.id;
      opt.textContent = `#${channel.name}`;
      if (channel.id === configured) opt.selected = true;
      select.appendChild(opt);
    }

    // If the configured channel no longer exists in the guild, still show it
    // (as a selected entry) so the admin can see what was configured and pick
    // a replacement or explicitly disable invite logging.
    if (configured && !(channels || []).some((c) => c.id === configured)) {
      const opt = document.createElement('option');
      opt.value = configured;
      opt.textContent = `#${configured}`;
      opt.selected = true;
      select.appendChild(opt);
    }
  }

  setControlsEnabled(enabled, select, saveBtn) {
    if (select) select.disabled = !enabled;
    if (saveBtn) saveBtn.disabled = !enabled;
  }

  async saveInviteLogSettings(e) {
    if (e) e.preventDefault();
    const guildId = this.getGuildId();
    const select = document.getElementById('setting-invite-log-channel');
    const saveBtn = document.getElementById('btn-save-invite-log');
    if (!guildId || !select) return;
    this.clearInviteImport();

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      const value = select.value || null;
      const data = await apiFetch(`/api/guilds/${guildId}/settings`, {
        method: 'PATCH',
        body: { invite_log_channel_id: value },
      });
      if (window.Mochi) {
        window.Mochi.showToast('Invite log settings updated.', 'success');
      }
    } catch (err) {
      console.error('[Settings] Error saving invite log settings:', err);
      if (window.Mochi) {
        window.Mochi.showToast(`Could not update invite log settings: ${err.message}`, 'leave');
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save changes';
      }
    }
  }

  async refreshStatus() {
    await window.Mochi.fetchStats();
    window.Mochi.showToast('Status refreshed.', 'success');
  }

  clearInviteImport() {
    this.importPreview = null;
    const summary = document.getElementById('invite-import-summary');
    const preview = document.getElementById('invite-import-preview');
    if (summary) summary.textContent = '';
    if (preview) preview.replaceChildren();
    this.updateImportControls();
  }

  updateImportControls() {
    const preview = document.getElementById('btn-preview-invite-import');
    const apply = document.getElementById('btn-apply-invite-import');
    const older = document.getElementById('btn-older-invite-import');
    if (preview) preview.disabled = this.importBusy || !this.guildId;
    if (apply) apply.disabled = this.importBusy || !this.importPreview?.changes?.length;
    if (older) older.disabled = this.importBusy || !this.importPreview?.nextBefore;
    for (const id of ['setting-import-format', 'setting-import-channel', 'setting-import-bot', 'setting-import-limit', 'setting-import-before', 'setting-import-unknown-inviter']) {
      const input = document.getElementById(id);
      if (input) input.disabled = this.importBusy;
    }
  }

  async previewInviteImport(event, continuationToken = undefined) {
    event?.preventDefault();
    const guildId = this.guildId;
    if (!guildId || this.importBusy) return;
    const sourceBotId = document.getElementById('setting-import-bot')?.value.trim();
    const sourceFormat = document.getElementById('setting-import-format')?.value || 'invite-logger';
    const channelId = document.getElementById('setting-import-channel')?.value || undefined;
    const unknownInviterId = sourceFormat === 'user-logs' ? document.getElementById('setting-import-unknown-inviter')?.value.trim() || '' : null;
    const before = document.getElementById('setting-import-before')?.value.trim();
    const limit = Number(document.getElementById('setting-import-limit')?.value || 1000);
    this.clearInviteImport();
    this.importBusy = true;
    const request = ++this.importRequest;
    this.updateImportControls();
    document.getElementById('invite-import-summary').textContent = 'Reading log messages…';
    try {
      const started = await apiFetch(`/api/guilds/${guildId}/invites/import-logs/preview`, { method: 'POST', body: { sourceBotId, sourceFormat, channelId, unknownInviterId, before, limit, continuationToken } });
      let data;
      if (!started.jobId) throw new Error('Refresh this page to load the current import controls.');
      while (true) {
        if (request !== this.importRequest || guildId !== this.guildId) return;
        const job = await apiFetch(`/api/guilds/${guildId}/invites/import-logs/preview/${started.jobId}`);
        if (request !== this.importRequest || guildId !== this.guildId) return;
        if (job.state === 'complete') { data = job.result; break; }
        if (job.state === 'failed') throw new Error(job.error?.message || 'The log scan failed.');
        document.getElementById('invite-import-summary').textContent = job.progress || 'Reading log messages…';
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (request !== this.importRequest || guildId !== this.guildId) return;
      this.importPreview = data;
      this.renderInviteImport(data, guildId);
    } catch (error) {
      if (request !== this.importRequest || guildId !== this.guildId) return;
      document.getElementById('invite-import-summary').textContent = `Could not create a preview: ${error.message}`;
    } finally {
      if (request === this.importRequest && guildId === this.guildId) {
        this.importBusy = false;
        this.updateImportControls();
      }
    }
  }

  renderInviteImport(data, guildId) {
    const summary = document.getElementById('invite-import-summary');
    summary.textContent = `Scanned ${data.scanned} channel messages. Found ${data.sourceMessages} messages from bot ${data.sourceBotId}. Retained ${data.retainedMessages} readable log entries from this scan and earlier pages. ${data.changes.length} membership periods can change. Skipped ${data.skipped.length} entries. The preview expires in ten minutes.`;
    if (data.notices?.length) summary.textContent += ` ${data.notices.join(' ')}`;
    const root = document.getElementById('invite-import-preview');
    root.replaceChildren();
    const sourceLink = (messageId) => {
      const link = document.createElement('a');
      link.href = `https://discord.com/channels/${guildId}/${data.channelId}/${messageId}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Source message';
      return link;
    };
    if (data.changes.length) {
      const list = document.createElement('ul');
      for (const change of data.changes) {
        const row = document.createElement('li');
        const member = change.memberName ? `${change.memberName} (${change.userId})` : change.userId;
        const inviter = change.inviterName ? `${change.inviterName} (${change.inviterId})` : change.inviterId;
        row.append(document.createTextNode(`${change.action === 'insert' ? (change.leftAt ? 'Restore join and leave' : 'Restore join') : 'Repair inviter'}: ${member} → ${inviter}. Period ${change.cycle}. Joined ${new Date(change.joinedAt || change.occurredAt).toLocaleString()}.${change.leftAt ? ` Left ${new Date(change.leftAt).toLocaleString()}.` : ''}${change.matchedByName ? ' Uses a current username match.' : ''} `));
        if (change.restoresLeave) row.append(document.createTextNode('Restores the missing leave. '));
        if (change.assumedInviter) row.append(document.createTextNode('Uses the requested unknown inviter fallback. '));
        if (change.overriddenFallback) row.append(document.createTextNode('Known inviter evidence takes priority over the unknown fallback. '));
        for (const source of change.sources) {
          const link = sourceLink(source.messageId);
          link.textContent = source.eventType === 'SNAPSHOT' ? 'Role update message' : source.eventType === 'JOIN' ? 'Join message' : 'Leave message';
          row.append(link, document.createTextNode(' '));
        }
        list.append(row);
      }
      root.append(list);
    }
    if (data.skipped.length) {
      const details = document.createElement('details');
      const heading = document.createElement('summary');
      heading.textContent = `Skipped entries (${data.skipped.length})`;
      details.append(heading);
      const list = document.createElement('ul');
      for (const skipped of data.skipped) {
        const row = document.createElement('li');
        row.append(document.createTextNode(`${skipped.reason}${skipped.text ? ` ${skipped.text}` : ''} `));
        row.append(sourceLink(skipped.messageId));
        list.append(row);
      }
      details.append(list);
      root.append(details);
    }
  }

  async applyInviteImport() {
    const guildId = this.guildId;
    const preview = this.importPreview;
    if (!guildId || !preview?.changes?.length || this.importBusy) return;
    this.importBusy = true;
    const request = ++this.importRequest;
    this.updateImportControls();
    try {
      const result = await apiFetch(`/api/guilds/${guildId}/invites/import-logs/apply`, { method: 'POST', body: { token: preview.token } });
      if (request !== this.importRequest || guildId !== this.guildId) return;
      this.importPreview = { ...preview, changes: [] };
      document.getElementById('invite-import-preview').replaceChildren();
      document.getElementById('invite-import-summary').textContent = result.message;
      window.Mochi?.showToast(result.message, 'success');
    } catch (error) {
      if (request !== this.importRequest || guildId !== this.guildId) return;
      this.importPreview = { ...preview, changes: [] };
      document.getElementById('invite-import-summary').textContent = `Could not apply the preview: ${error.message} Create a new preview before trying again.`;
    } finally {
      if (request === this.importRequest && guildId === this.guildId) {
        this.importBusy = false;
        this.updateImportControls();
      }
    }
  }

  async previewOlderInviteImport() {
    const before = this.importPreview?.nextBefore;
    const continuationToken = this.importPreview?.token;
    if (!before || this.importBusy) return;
    document.getElementById('setting-import-before').value = before;
    await this.previewInviteImport(undefined, continuationToken);
  }
}

window.settingsPage = new SettingsPage();
