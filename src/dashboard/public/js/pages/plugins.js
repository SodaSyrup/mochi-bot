/** Per-guild plugin controls. All external values are rendered with textContent. */
class PluginsPage {
  constructor() {
    this.guildId = null;
    this.plugins = [];
    this.loadToken = 0;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    window.Mochi?.onGuildChange((guildId) => this.onGuildChange(guildId));
  }

  async onGuildChange(guildId) {
    this.guildId = guildId;
    const token = ++this.loadToken;
    this.renderLoading();
    if (!guildId) return;
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/plugins`);
      if (token !== this.loadToken) return;
      this.plugins = data.plugins || [];
      this.render();
    } catch (error) {
      if (token !== this.loadToken) return;
      console.error('[Plugins] Error loading plugin settings:', error);
      this.renderError(error.message);
    }
  }

  async reload() {
    if (this.guildId) await this.onGuildChange(this.guildId);
  }

  renderLoading() {
    const list = document.getElementById('plugin-list');
    if (list) list.textContent = 'Loading plugins…';
  }

  renderError(message) {
    const list = document.getElementById('plugin-list');
    if (!list) return;
    list.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('div');
    title.className = 'empty-title';
    title.textContent = 'Could not load plugins.';
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = message || 'Try refreshing the page.';
    empty.append(title, hint);
    list.appendChild(empty);
  }

  render() {
    const list = document.getElementById('plugin-list');
    if (!list) return;
    list.textContent = '';
    if (!this.plugins.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No plugins are available.';
      list.appendChild(empty);
      return;
    }

    for (const plugin of this.plugins) {
      const row = document.createElement('div');
      row.className = 'plugin-row';

      const details = document.createElement('div');
      details.className = 'plugin-details';
      const name = document.createElement('div');
      name.className = 'plugin-name';
      name.textContent = plugin.name || plugin.id;
      const meta = document.createElement('div');
      meta.className = 'plugin-meta';
      meta.textContent = `${plugin.id} · v${plugin.version}`;
      const description = document.createElement('div');
      description.className = 'plugin-description';
      description.textContent = plugin.description || 'No description provided.';
      details.append(name, meta, description);

      const actions = document.createElement('div');
      actions.className = 'plugin-actions';
      const state = document.createElement('span');
      state.className = `status ${plugin.enabled ? 'status-connected' : 'status-disconnected'}`;
      state.textContent = plugin.enabled ? 'Enabled' : 'Disabled';
      const button = document.createElement('button');
      button.className = 'button button-secondary button-sm';
      button.type = 'button';
      button.textContent = plugin.enabled ? 'Disable' : 'Enable';
      button.disabled = Boolean(plugin.locked);
      button.title = plugin.globallyDisabled
        ? 'Disabled by application configuration.'
        : plugin.requires?.length
          ? `Requires: ${plugin.requires.join(', ')}`
          : '';
      button.addEventListener('click', () => this.toggle(plugin, button));
      if (plugin.globallyDisabled) {
        const locked = document.createElement('span');
        locked.className = 'plugin-locked';
        locked.textContent = 'Locked by configuration';
        actions.append(state, locked);
      } else if (plugin.blockedBy?.length) {
        const locked = document.createElement('span');
        locked.className = 'plugin-locked';
        locked.textContent = `Requires: ${plugin.blockedBy.join(', ')}`;
        actions.append(state, locked);
      } else {
        actions.append(state, button);
      }

      row.append(details, actions);
      list.appendChild(row);
    }
  }

  async toggle(plugin, button) {
    if (!this.guildId || plugin.globallyDisabled) return;
    button.disabled = true;
    try {
      await apiFetch(`/api/guilds/${this.guildId}/plugins/${encodeURIComponent(plugin.id)}`, {
        method: 'PATCH',
        body: { enabled: !plugin.enabled },
      });
      window.Mochi?.showToast(`${plugin.name} ${plugin.enabled ? 'disabled' : 'enabled'}.`, 'success');
      await this.reload();
    } catch (error) {
      console.error('[Plugins] Error updating plugin:', error);
      window.Mochi?.showToast(`Could not update ${plugin.name}: ${error.message}`, 'leave');
      button.disabled = false;
    }
  }
}

window.pluginsPage = new PluginsPage();
