class PermissionGroupsPage {
  constructor() {
    this.guildId = null;
    this.groups = [];
    this.categories = [];
    this.channels = [];
    this.roles = [];
    this.permissions = [];
    this.existingOverwrites = [];
    this.selectedTargetId = null;
    this.editingId = null;
    this.loadToken = 0;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => this.init());
    else this.init();
  }

  init() {
    document.getElementById('new-permission-group')?.addEventListener('click', () => this.openEditor());
    document.getElementById('permission-group-form')?.addEventListener('submit', (event) => this.save(event));
    document.getElementById('cancel-permission-group')?.addEventListener('click', () => this.closeEditor());
    document.getElementById('delete-permission-group')?.addEventListener('click', () => this.remove());
    document.getElementById('add-permission-rule')?.addEventListener('click', () => this.addRule());
    document.getElementById('add-permission-channel-rule')?.addEventListener('click', () => this.addRule(null, 'permission-channel-rule-list', 'channel'));
    window.Mochi?.onGuildChange((guildId) => this.load(guildId));
  }

  async load(guildId) {
    this.guildId = guildId;
    this.closeEditor();
    const token = ++this.loadToken;
    if (!guildId) {
      this.groups = [];
      this.categories = [];
      this.channels = [];
      this.existingOverwrites = [];
      this.renderChannelTree();
      this.renderGroups();
      this.clearSelectedTarget();
      return;
    }
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/permission-groups`);
      if (token !== this.loadToken) return;
      this.groups = data.groups || [];
      this.categories = data.categories || [];
      this.channels = data.channels || [];
      this.roles = data.roles || [];
      this.permissions = data.permissions || [];
      this.existingOverwrites = data.existingOverwrites || [];
      // The server tree is independent from group selection and must render
      // immediately when guild data arrives.
      this.renderChannelTree();
      this.renderGroups();
      this.clearSelectedTarget();
    } catch (error) {
      if (token !== this.loadToken) return;
      this.categories = [];
      this.channels = [];
      this.existingOverwrites = [];
      this.renderChannelTree('Could not load the Discord channel layout.');
      this.clearSelectedTarget();
      const message = error.status === 403
        ? 'Enable Permission Groups for this server first.'
        : `Could not load permission groups: ${error.message}`;
      window.Mochi?.showToast(message, 'leave');
    }
  }

  renderGroups() {
    const list = document.getElementById('permission-group-list');
    if (!list) return;
    list.textContent = '';
    if (!this.groups.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = document.createElement('div');
      title.className = 'empty-title';
      title.textContent = 'No permission groups yet.';
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Create one to link your project categories.';
      empty.append(title, hint);
      list.appendChild(empty);
      return;
    }
    for (const group of this.groups) {
      const row = document.createElement('div');
      row.className = `permission-group-row${group.id === this.editingId ? ' active' : ''}`;
      const details = document.createElement('button');
      details.type = 'button';
      details.className = 'permission-group-select';
      const name = document.createElement('strong');
      name.textContent = group.name;
      const meta = document.createElement('span');
      meta.textContent = `${group.categoryIds.length} ${group.categoryIds.length === 1 ? 'category' : 'categories'} · ${group.rules.length} shared ${group.rules.length === 1 ? 'role' : 'roles'}`;
      details.append(name, meta);
      details.addEventListener('click', () => this.openEditor(group));
      const sync = document.createElement('button');
      sync.type = 'button';
      sync.className = 'button button-secondary button-sm';
      sync.textContent = 'Sync';
      sync.addEventListener('click', () => this.sync(group.id, sync));
      row.append(details, sync);
      list.appendChild(row);
    }
  }

  selectTarget(target) {
    const panel = document.getElementById('selected-target-panel');
    const title = document.getElementById('selected-target-title');
    const list = document.getElementById('selected-target-overwrites');
    if (!panel || !title || !list) return;
    this.selectedTargetId = target.id;
    this.renderChannelTree();
    panel.hidden = false;
    title.textContent = `${target.type === 'category' ? 'Category' : 'Channel'} · ${target.name}`;
    list.textContent = '';
    const overwrites = this.existingOverwrites.filter((overwrite) => overwrite.targetId === target.id);
    if (!overwrites.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = document.createElement('div');
      title.className = 'empty-title';
      title.textContent = 'No role overwrites on this target.';
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Use the group editor below to add a role overwrite.';
      empty.append(title, hint);
      list.appendChild(empty);
      return;
    }
    for (const overwrite of overwrites) {
      const row = document.createElement('div');
      row.className = 'existing-overwrite-row';
      const details = document.createElement('div');
      details.className = 'existing-overwrite-details';
      const title = document.createElement('strong');
      title.textContent = `${overwrite.roleName} · ${overwrite.targetName}`;
      const meta = document.createElement('span');
      meta.textContent = `${overwrite.targetType === 'category' ? 'Category' : 'Channel'} · ${this.permissionSummary(overwrite.permissions)}`;
      details.append(title, meta);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-secondary button-sm';
      button.textContent = 'Edit';
      const channel = this.channels.find((candidate) => candidate.id === overwrite.targetId);
      if (!this.roles.some((role) => role.id === overwrite.roleId)) {
        button.disabled = true;
        button.title = 'This role is managed by a Discord integration and cannot be edited by Mochi.';
      } else if (overwrite.targetType === 'channel' && !channel?.parentId) {
        button.disabled = true;
        button.title = 'Only channels inside a grouped category can be managed here.';
      } else {
        button.addEventListener('click', () => this.editExisting(overwrite));
      }
      row.append(details, button);
      list.appendChild(row);
    }
  }

  clearSelectedTarget() {
    this.selectedTargetId = null;
    const panel = document.getElementById('selected-target-panel');
    if (panel) panel.hidden = true;
    const list = document.getElementById('selected-target-overwrites');
    if (list) list.textContent = '';
  }

  permissionSummary(states = {}) {
    const allowed = this.permissions.filter((permission) => states[permission.key] === 'allow').map((permission) => `+${permission.label}`);
    const denied = this.permissions.filter((permission) => states[permission.key] === 'deny').map((permission) => `−${permission.label}`);
    const summary = [...allowed, ...denied];
    return summary.length ? summary.slice(0, 3).join(', ') + (summary.length > 3 ? '…' : '') : 'Explicit overwrite';
  }

  editExisting(overwrite) {
    const channel = this.channels.find((candidate) => candidate.id === overwrite.targetId);
    const parentId = overwrite.targetType === 'category' ? overwrite.targetId : channel?.parentId;
    const group = this.groups.find((candidate) => candidate.categoryIds.includes(parentId));
    this.openEditor(group || null);
    if (!group) {
      document.getElementById('permission-group-name').value = `${overwrite.targetName} permissions`;
      const category = document.querySelector(`#permission-group-category-options input[value="${parentId}"]`);
      if (category) category.checked = true;
    }
    const listId = overwrite.targetType === 'channel' ? 'permission-channel-rule-list' : 'permission-rule-list';
    const targetType = overwrite.targetType;
    const rows = Array.from(document.querySelectorAll(`#${listId} .permission-rule`));
    const existing = rows.find((row) => (
      row.querySelector('.permission-role-select')?.value === overwrite.roleId &&
      (targetType === 'category' || row.querySelector('.permission-channel-select')?.value === overwrite.targetId)
    ));
    const row = existing || (this.addRule({ targetType, targetId: overwrite.targetId, roleId: overwrite.roleId, permissions: overwrite.permissions }, listId, targetType), document.querySelectorAll(`#${listId} .permission-rule`)[document.querySelectorAll(`#${listId} .permission-rule`).length - 1]);
    for (const select of row.querySelectorAll('[data-permission]')) {
      select.value = overwrite.permissions[select.dataset.permission] || 'inherit';
      select.dataset.state = select.value;
    }
  }

  openEditor(group = null) {
    this.editingId = group?.id || null;
    document.getElementById('permission-group-editor').hidden = false;
    document.getElementById('permission-group-editor-title').textContent = group ? `Edit ${group.name}` : 'New group';
    document.getElementById('permission-group-name').value = group?.name || '';
    document.getElementById('delete-permission-group').hidden = !group;
    this.renderChannelTree();
    this.renderGroupCategoryOptions(new Set(group?.categoryIds || []));
    const rules = document.getElementById('permission-rule-list');
    rules.textContent = '';
    const channelRules = document.getElementById('permission-channel-rule-list');
    channelRules.textContent = '';
    for (const rule of group?.rules || []) {
      if (rule.targetType === 'channel') this.addRule(rule, 'permission-channel-rule-list', 'channel');
      else this.addRule(rule, 'permission-rule-list', 'category');
    }
    this.renderGroups();
  }

  closeEditor() {
    this.editingId = null;
    const editor = document.getElementById('permission-group-editor');
    if (editor) editor.hidden = true;
    this.renderGroups();
    if (document.getElementById('permission-category-list')) this.renderChannelTree();
  }

  renderChannelTree(emptyMessage = 'No Discord channels are available.') {
    const list = document.getElementById('permission-category-list');
    if (!list) return;
    list.textContent = '';
    if (!this.categories.length && !this.channels.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = document.createElement('div');
      title.className = 'empty-title';
      title.textContent = emptyMessage;
      empty.appendChild(title);
      list.appendChild(empty);
      return;
    }
    const occupied = new Map();
    for (const group of this.groups) {
      for (const id of group.categoryIds) occupied.set(id, group.name);
    }
    const renderChannel = (channel) => {
      const row = document.createElement('div');
      row.className = 'permission-channel-row';
      if (this.selectedTargetId === channel.id) row.classList.add('selected');
      const icon = document.createElement('i');
      icon.className = `fa-solid ${this.channelIcon(channel.type)}`;
      icon.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.textContent = channel.name;
      row.append(icon, name);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open permissions for ${channel.name}`);
      row.addEventListener('click', () => this.selectTarget({ ...channel, type: 'channel' }));
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') this.selectTarget({ ...channel, type: 'channel' }); });
      return row;
    };

    const renderedChannelIds = new Set();
    const uncategorized = this.channels.filter((channel) => !channel.parentId);
    if (uncategorized.length) {
      const block = document.createElement('div');
      block.className = 'permission-category-block permission-category-uncategorized';
      const heading = document.createElement('div');
      heading.className = 'permission-category-heading';
      const label = document.createElement('span');
      label.className = 'permission-category-name';
      label.textContent = 'Uncategorized';
      const note = document.createElement('span');
      note.className = 'permission-category-state';
      note.textContent = 'Not selectable';
      heading.append(label, note);
      block.appendChild(heading);
      for (const channel of uncategorized) {
        renderedChannelIds.add(channel.id);
        block.appendChild(renderChannel(channel));
      }
      list.appendChild(block);
    }

    for (const category of this.categories) {
      const block = document.createElement('div');
      block.className = 'permission-category-block';
      const heading = document.createElement('div');
      heading.className = 'permission-category-heading';
      if (this.selectedTargetId === category.id) heading.classList.add('selected');
      heading.tabIndex = 0;
      heading.setAttribute('role', 'button');
      heading.setAttribute('aria-label', `Open permissions for category ${category.name}`);
      const text = document.createElement('span');
      text.className = 'permission-category-name';
      text.textContent = category.name;
      heading.appendChild(text);
      const ownerName = occupied.get(category.id);
      if (ownerName) {
        const owner = document.createElement('span');
        owner.className = 'permission-category-state';
        owner.textContent = `In ${ownerName}`;
        heading.appendChild(owner);
      } else {
        const state = document.createElement('span');
        state.className = 'permission-category-state';
        state.textContent = 'Available';
        heading.appendChild(state);
      }
      block.appendChild(heading);
      heading.addEventListener('click', () => this.selectTarget({ ...category, type: 'category' }));
      heading.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') this.selectTarget({ ...category, type: 'category' }); });
      for (const channel of this.channels.filter((candidate) => candidate.parentId === category.id)) {
        renderedChannelIds.add(channel.id);
        block.appendChild(renderChannel(channel));
      }
      list.appendChild(block);
    }

    // A stale or partially available Discord category cache should never make
    // a channel disappear from the dashboard. Keep any unmatched channels in
    // a visible fallback section until their parent category is available.
    const otherChannels = this.channels.filter((channel) => !renderedChannelIds.has(channel.id));
    if (otherChannels.length) {
      const block = document.createElement('div');
      block.className = 'permission-category-block permission-category-uncategorized';
      const heading = document.createElement('div');
      heading.className = 'permission-category-heading';
      const label = document.createElement('span');
      label.className = 'permission-category-name';
      label.textContent = 'Other channels';
      const note = document.createElement('span');
      note.className = 'permission-category-state';
      note.textContent = 'Category unavailable';
      heading.append(label, note);
      block.appendChild(heading);
      for (const channel of otherChannels) block.appendChild(renderChannel(channel));
      list.appendChild(block);
    }
  }

  renderGroupCategoryOptions(selected) {
    const list = document.getElementById('permission-group-category-options');
    if (!list) return;
    list.textContent = '';
    const occupied = new Map();
    for (const group of this.groups) {
      if (group.id !== this.editingId) for (const id of group.categoryIds) occupied.set(id, group.name);
    }
    for (const category of this.categories) {
      const label = document.createElement('label');
      label.className = 'permission-group-category-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = category.id;
      checkbox.checked = selected.has(category.id);
      checkbox.disabled = occupied.has(category.id);
      const text = document.createElement('span');
      text.textContent = occupied.has(category.id) ? `${category.name} — in ${occupied.get(category.id)}` : category.name;
      label.append(checkbox, text);
      list.appendChild(label);
    }
  }

  channelIcon(type) {
    if (type === 2) return 'fa-volume-high';
    if (type === 5) return 'fa-bullhorn';
    if (type === 13) return 'fa-podcast';
    if (type === 15 || type === 16) return 'fa-comments';
    return 'fa-hashtag';
  }

  addRule(rule = null, listId = 'permission-rule-list', targetType = 'category') {
    if (!this.roles.length) return;
    const row = document.createElement('div');
    row.className = 'permission-rule';
    const top = document.createElement('div');
    top.className = 'permission-rule-top';
    if (targetType === 'channel') {
      const channel = document.createElement('select');
      channel.className = 'form-control permission-channel-select';
      for (const candidate of this.channels.filter((entry) => entry.parentId)) {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = this.channelLabel(candidate);
        option.selected = candidate.id === rule?.targetId;
        channel.appendChild(option);
      }
      top.appendChild(channel);
    }
    const role = document.createElement('select');
    role.className = 'form-control permission-role-select';
    for (const candidate of this.roles) {
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = candidate.name;
      option.selected = candidate.id === rule?.roleId;
      role.appendChild(option);
    }
    row.dataset.targetType = targetType;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button-icon danger';
    remove.setAttribute('aria-label', 'Remove shared role');
    remove.textContent = '×';
    remove.addEventListener('click', () => row.remove());
    top.append(role, remove);

    const grid = document.createElement('div');
    grid.className = 'permission-state-grid';
    for (const permission of this.permissions) {
      const label = document.createElement('label');
      label.className = 'permission-state';
      const name = document.createElement('span');
      name.textContent = permission.label;
      const select = document.createElement('select');
      select.className = 'form-control';
      select.dataset.permission = permission.key;
      for (const [value, text] of [['inherit', 'Inherit'], ['allow', 'Allow'], ['deny', 'Deny']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = (rule?.permissions?.[permission.key] || 'inherit') === value;
        select.appendChild(option);
      }
      select.addEventListener('change', () => { select.dataset.state = select.value; });
      select.dataset.state = select.value;
      label.append(name, select);
      grid.appendChild(label);
    }
    row.append(top, grid);
    document.getElementById(listId).appendChild(row);
  }

  channelLabel(channel) {
    const type = channel.type;
    const prefix = type === 2 ? '🔊' : type === 5 ? '📣' : type === 13 ? '🎙' : (type === 15 || type === 16) ? '🧵' : '#';
    return `${prefix} ${channel.name}`;
  }

  payload() {
    const categoryIds = Array.from(document.querySelectorAll('#permission-group-category-options input:checked')).map((input) => input.value);
    const rules = Array.from(document.querySelectorAll('.permission-rule')).map((row) => ({
      targetType: row.dataset.targetType || 'category',
      targetId: row.querySelector('.permission-channel-select')?.value || null,
      roleId: row.querySelector('.permission-role-select').value,
      permissions: Object.fromEntries(Array.from(row.querySelectorAll('[data-permission]')).map((select) => [select.dataset.permission, select.value])),
    }));
    return { name: document.getElementById('permission-group-name').value, categoryIds, rules };
  }

  async save(event) {
    event.preventDefault();
    if (!this.guildId) return;
    const button = document.getElementById('save-permission-group');
    button.disabled = true;
    button.textContent = 'Applying…';
    try {
      const path = this.editingId ? `/${this.editingId}` : '';
      await apiFetch(`/api/guilds/${this.guildId}/permission-groups${path}`, {
        method: this.editingId ? 'PATCH' : 'POST',
        body: this.payload(),
      });
      await this.load(this.guildId);
      window.Mochi?.showToast('Permission group applied to Discord.', 'success');
    } catch (error) {
      window.Mochi?.showToast(`Could not save group: ${error.message}`, 'leave');
    } finally {
      button.disabled = false;
      button.textContent = 'Save and apply';
    }
  }

  async sync(groupId, button) {
    button.disabled = true;
    try {
      await apiFetch(`/api/guilds/${this.guildId}/permission-groups/${groupId}/sync`, { method: 'POST' });
      window.Mochi?.showToast('Shared permissions synced.', 'success');
    } catch (error) {
      window.Mochi?.showToast(`Could not sync group: ${error.message}`, 'leave');
    } finally { button.disabled = false; }
  }

  async remove() {
    if (!this.editingId || !confirm('Delete this group and clear its shared permission layer from the categories?')) return;
    try {
      await apiFetch(`/api/guilds/${this.guildId}/permission-groups/${this.editingId}`, { method: 'DELETE' });
      await this.load(this.guildId);
      window.Mochi?.showToast('Permission group deleted.', 'success');
    } catch (error) {
      window.Mochi?.showToast(`Could not delete group: ${error.message}`, 'leave');
    }
  }
}

window.permissionGroupsPage = new PermissionGroupsPage();
