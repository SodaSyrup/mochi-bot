/** Dashboard Honeypot page. */
class HoneypotPage {
  constructor() {
    this.guildId = null;
    this.honeypot = null;
    this.channels = [];
    this.recentKicks = [];
    this.permissions = null;
    this.loadToken = 0;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    window.Mochi?.onGuildChange((guildId) => this.onGuildChange(guildId));
    window.Mochi?.onRealtime('honeypotTriggered', (payload) => {
      if (payload?.guildId !== this.guildId || !this.honeypot) return;
      if (payload.channelId === this.honeypot.channel_id) {
        this.honeypot.kicks = payload.kicks;
        this.recentKicks.unshift({
          user_id: payload.userId || null,
          username: payload.username || 'Recently kicked player',
          occurred_at: payload.occurredAt,
        });
        this.recentKicks = this.recentKicks.slice(0, 10);
        this.renderRecentKicks();
        this.renderStatus();
      }
    });
  }

  async onGuildChange(guildId) {
    this.guildId = guildId;
    const token = ++this.loadToken;
    this.setControlsEnabled(false);

    if (!guildId) {
      this.honeypot = null;
      this.channels = [];
      this.recentKicks = [];
      this.permissions = null;
      this.render();
      return;
    }

    try {
      const [honeypotData, channelsData] = await Promise.all([
        apiFetch(`/api/guilds/${guildId}/honeypot`),
        apiFetch(`/api/guilds/${guildId}/channels`),
      ]);
      if (token !== this.loadToken) return;

      this.honeypot = honeypotData.honeypot || null;
      this.recentKicks = honeypotData.recentKicks || [];
      this.permissions = honeypotData.permissions || null;
      this.channels = (channelsData.channels || []).filter((channel) => channel.type === 0 || channel.type === 5);
      this.populateChannelSelect();
      this.render();
    } catch (error) {
      console.error('[Honeypot] Error loading configuration:', error);
      window.Mochi?.showToast('Could not load honeypot settings.', 'leave');
    } finally {
      if (token === this.loadToken) this.setControlsEnabled(true);
    }
  }

  populateChannelSelect() {
    const select = document.getElementById('honeypot-channel-select');
    if (!select) return;

    const configured = this.honeypot?.channel_id || '';
    select.textContent = '';

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No channel selected';
    select.appendChild(empty);

    for (const channel of this.channels) {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = `#${channel.name}`;
      option.selected = channel.id === configured;
      select.appendChild(option);
    }

    if (configured && !this.channels.some((channel) => channel.id === configured)) {
      const option = document.createElement('option');
      option.value = configured;
      option.textContent = `#${configured} (configured but unavailable)`;
      option.selected = true;
      select.appendChild(option);
    }
  }

  render() {
    this.renderStatus();
    this.renderRecentKicks();
    this.renderPermissions();
    const select = document.getElementById('honeypot-channel-select');
    if (select && this.honeypot?.channel_id) select.value = this.honeypot.channel_id;
  }

  renderStatus() {
    const configured = Boolean(this.honeypot);
    const channel = this.channels.find((candidate) => candidate.id === this.honeypot?.channel_id);
    const channelName = channel ? `#${channel.name}` : (this.honeypot ? `#${this.honeypot.channel_id}` : '—');
    const kicks = this.honeypot?.kicks || 0;

    this.setText('honeypot-status', configured ? 'Enabled' : 'Disabled');
    this.setText('honeypot-kicks', String(kicks));
    this.setText('honeypot-channel', channelName);
    this.setText('honeypot-preview-kicks', String(kicks));

    const saveButton = document.getElementById('btn-save-honeypot');
    const disableButton = document.getElementById('btn-disable-honeypot');
    if (saveButton) saveButton.textContent = configured ? 'Save channel' : 'Enable honeypot';
    if (disableButton) disableButton.disabled = !configured;
  }

  renderRecentKicks() {
    const list = document.getElementById('honeypot-kick-list');
    if (!list) return;
    list.textContent = '';

    if (!this.recentKicks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = document.createElement('div');
      title.className = 'empty-title';
      title.textContent = 'No recent kicks.';
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Triggered messages will appear here.';
      empty.append(title, hint);
      list.appendChild(empty);
      return;
    }

    for (const kick of this.recentKicks) {
      const row = document.createElement('div');
      row.className = 'honeypot-kick-row';

      const identity = document.createElement('div');
      identity.className = 'honeypot-kick-identity';
      const name = document.createElement('div');
      name.className = 'honeypot-kick-name';
      name.textContent = kick.username || 'Unknown user';
      const id = document.createElement('div');
      id.className = 'honeypot-kick-id';
      id.textContent = kick.user_id ? `ID: ${kick.user_id}` : 'User ID unavailable';
      identity.append(name, id);

      const time = document.createElement('time');
      time.className = 'honeypot-kick-time';
      time.dateTime = kick.occurred_at || '';
      time.textContent = this.formatTime(kick.occurred_at);

      row.append(identity, time);
      list.appendChild(row);
    }
  }

  renderPermissions() {
    const section = document.getElementById('honeypot-permissions-section');
    const copy = document.getElementById('honeypot-permissions-copy');
    if (!section) return;

    const labels = [
      ['viewChannel', 'View Channel'],
      ['sendMessages', 'Send Messages'],
      ['embedLinks', 'Embed Links'],
      ['banMembers', 'Ban Members'],
    ];
    const missing = this.permissions
      ? labels.filter(([key]) => !this.permissions[key]).map(([, label]) => label)
      : [];
    section.hidden = missing.length === 0;
    if (copy && missing.length) {
      copy.textContent = `Mochi is missing: ${missing.join(', ')}. Update the bot’s Discord permissions before enabling or using the honeypot.`;
    }
  }

  formatTime(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  async save(event) {
    event?.preventDefault();
    if (!this.guildId) return;
    const select = document.getElementById('honeypot-channel-select');
    const button = document.getElementById('btn-save-honeypot');
    if (!select?.value) {
      window.Mochi?.showToast('Choose a channel first.', 'leave');
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const data = await apiFetch(`/api/guilds/${this.guildId}/honeypot`, {
        method: 'PATCH',
        body: { channelId: select.value },
      });
      this.honeypot = data.honeypot;
      this.recentKicks = data.recentKicks || [];
      this.permissions = data.permissions || null;
      this.render();
      window.Mochi?.showToast('Honeypot enabled.', 'success');
    } catch (error) {
      console.error('[Honeypot] Error saving configuration:', error);
      window.Mochi?.showToast(`Could not configure honeypot: ${error.message}`, 'leave');
    } finally {
      if (button) button.disabled = false;
      this.renderStatus();
    }
  }

  async disable() {
    if (!this.guildId || !this.honeypot) return;
    const button = document.getElementById('btn-disable-honeypot');
    if (button) {
      button.disabled = true;
      button.textContent = 'Disabling…';
    }
    try {
      await apiFetch(`/api/guilds/${this.guildId}/honeypot`, {
        method: 'PATCH',
        body: { channelId: null },
      });
      this.honeypot = null;
      this.recentKicks = [];
      this.permissions = null;
      this.render();
      window.Mochi?.showToast('Honeypot disabled.', 'success');
    } catch (error) {
      console.error('[Honeypot] Error disabling configuration:', error);
      window.Mochi?.showToast(`Could not disable honeypot: ${error.message}`, 'leave');
    } finally {
      this.renderStatus();
    }
  }

  async refresh() {
    await this.onGuildChange(this.guildId);
  }

  setControlsEnabled(enabled) {
    for (const id of ['honeypot-channel-select', 'btn-save-honeypot', 'btn-disable-honeypot']) {
      const control = document.getElementById(id);
      if (control) control.disabled = !enabled;
    }
    if (enabled) this.renderStatus();
  }

  setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }
}

window.honeypotPage = new HoneypotPage();
