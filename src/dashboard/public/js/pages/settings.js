/**
 * Settings Page Script
 */

class SettingsPage {
  constructor() {
    this.guildId = null;
    // Monotonic token so a slow async response for guild A is never applied
    // after the user has switched to guild B.
    this.loadToken = 0;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
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
}

window.settingsPage = new SettingsPage();
