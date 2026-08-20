/**
 * Invite Links (codes) Page Script
 */

class CodesPage {
  constructor() {
    this.currentGuildId = null;
    this.channels = [];
    this.activeCodes = [];
    this.codesFilter = 'all';
    this.searchQuery = '';
    this.editingInviteCode = null;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    window.Mochi.onGuildChange((guildId) => {
      this.currentGuildId = guildId;
      this.fetchActiveCodes();
      this.fetchChannels();
    });

    window.addEventListener('mochi:close-modals', () => {
      this.closeCreateInviteModal();
      this.closeEditLabelModal();
    });

    window.Mochi.onRealtime('inviteCreated', () => {
      this.fetchActiveCodes();
    });

    window.Mochi.onRealtime('inviteLabelUpdated', (payload) => {
      const found = this.activeCodes.find(i => i.code === payload.code);
      if (found) {
        found.label = payload.label;
        this.renderCodesTable();
      }
    });

    window.Mochi.onRealtime('inviteDeleted', (payload) => {
      this.activeCodes = this.activeCodes.filter(i => i.code !== payload.code);
      this.renderCodesTable();
    });

    window.Mochi.onRealtime('memberJoin', () => {
      this.fetchActiveCodes();
    });
  }

  async fetchActiveCodes() {
    if (!this.currentGuildId) return;

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/active-codes`);
      this.activeCodes = data.invites || [];
      this.renderCodesTable();
    } catch (e) {
      console.error('Error fetching active codes:', e);
    }
  }

  async fetchChannels() {
    if (!this.currentGuildId) return;

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/channels`);
      this.channels = data.channels || [];

      const chanSelect = document.getElementById('create-invite-channel');
      if (chanSelect) {
        chanSelect.innerHTML = '';
        this.channels.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = `# ${c.name}`;
          chanSelect.appendChild(opt);
        });
        if (this.channels.length > 0) {
          chanSelect.value = this.channels[0].id;
        }
      }
    } catch (e) {
      console.error('Error fetching channels:', e);
    }
  }

  setCodesFilter(filter) {
    this.codesFilter = filter;
    document.querySelectorAll('#codes-filter-bar .seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });
    this.renderCodesTable();
  }

  filterCodes() {
    const input = document.getElementById('codes-search-input');
    this.searchQuery = input ? input.value.toLowerCase().trim() : '';
    this.renderCodesTable();
  }

  renderCodesTable() {
    const tbody = document.querySelector('#codes-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let list = this.activeCodes;

    // Apply Filter
    if (this.codesFilter === 'labeled') {
      list = list.filter(i => Boolean(i.label && i.label.trim()));
    } else if (this.codesFilter === 'unlabeled') {
      list = list.filter(i => !i.label || !i.label.trim());
    }

    // Apply Search Query
    if (this.searchQuery) {
      list = list.filter(i => {
        const codeMatch = i.code?.toLowerCase().includes(this.searchQuery);
        const labelMatch = i.label?.toLowerCase().includes(this.searchQuery);
        const userMatch = i.inviter?.username?.toLowerCase().includes(this.searchQuery);
        const chanMatch = i.channelName?.toLowerCase().includes(this.searchQuery);
        return codeMatch || labelMatch || userMatch || chanMatch;
      });
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <div class="empty-title">No invite links found.</div>
            <div class="empty-hint">Create an invite to start tracking a campaign.</div>
          </td>
        </tr>`;
      return;
    }

    list.forEach(inv => {
      const tr = document.createElement('tr');
      const hasLabel = Boolean(inv.label && inv.label.trim());
      const safeCode = escapeHtml(inv.code);
      const safeLabel = escapeHtml(inv.label || '');

      // Label column HTML
      let labelHtml = '';
      if (hasLabel) {
        labelHtml = `
          <span class="badge badge-neutral">${safeLabel}</span>
          <button class="button-icon" title="Edit label" aria-label="Edit label" onclick="codesPage.openEditLabelModal('${safeCode}')">
            <i class="fa-solid fa-pen" aria-hidden="true"></i>
          </button>`;
      } else {
        labelHtml = `
          <button class="button button-secondary button-sm" onclick="codesPage.openEditLabelModal('${safeCode}')">Add label</button>`;
      }

      // Channel column
      const chanName = escapeHtml(inv.channelName || (inv.channelId ? inv.channelId.replace('chan_', '') : 'general'));

      // Uses / Limit
      const usesCount = inv.uses || 0;
      const maxUsesText = inv.maxUses > 0 ? `/ ${inv.maxUses}` : 'unlimited';

      // Creator
      const creatorName = escapeHtml(inv.inviter?.username || inv.inviterId || 'Server');

      tr.innerHTML = `
        <td>
          <div class="invite-link-cell">
            <a class="mono invite-link" href="https://discord.gg/${safeCode}" target="_blank" rel="noopener">discord.gg/${safeCode}</a>
            <button class="button-icon" title="Copy link" aria-label="Copy link" onclick="codesPage.copyInviteCode('${safeCode}')">
              <i class="fa-solid fa-copy" aria-hidden="true"></i>
            </button>
          </div>
        </td>
        <td><div class="label-cell">${labelHtml}</div></td>
        <td><span class="channel-name"># ${chanName}</span></td>
        <td><span class="num">${usesCount}</span> <span class="text-muted text-small">${maxUsesText}</span></td>
        <td><span class="text-secondary">${creatorName}</span></td>
        <td class="actions-group">
          <button class="button button-secondary button-sm" onclick="codesPage.openEditLabelModal('${safeCode}')">Label</button>
          <button class="button-icon danger" title="Delete invite" aria-label="Delete invite" onclick="codesPage.deleteInvite('${safeCode}')">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async copyInviteCode(code) {
    try {
      await navigator.clipboard.writeText(`https://discord.gg/${code}`);
      window.Mochi.showToast([{ text: 'Copied invite link: ' }, { code: code }], 'success');
    } catch (e) {
      window.Mochi.showToast('Could not copy the invite link.', 'leave');
    }
  }

  openCreateInviteModal() {
    this.fetchChannels();
    const labelInput = document.getElementById('create-invite-label');
    const maxAgeSelect = document.getElementById('create-invite-max-age');
    const maxUsesSelect = document.getElementById('create-invite-max-uses');
    const tempCheck = document.getElementById('create-invite-temp');

    if (labelInput) labelInput.value = '';
    if (maxAgeSelect) maxAgeSelect.value = '0';
    if (maxUsesSelect) maxUsesSelect.value = '0';
    if (tempCheck) tempCheck.checked = false;

    this.updatePreview();
    const modal = document.getElementById('create-invite-modal');
    if (modal) modal.classList.add('active');
    const channelSelect = document.getElementById('create-invite-channel');
    if (channelSelect) channelSelect.focus();
  }

  closeCreateInviteModal() {
    const modal = document.getElementById('create-invite-modal');
    if (modal) modal.classList.remove('active');
  }

  updatePreview() {
    const labelInput = document.getElementById('create-invite-label');
    const labelVal = labelInput ? labelInput.value.trim() : '';

    const chanSelect = document.getElementById('create-invite-channel');
    const chanText = chanSelect && chanSelect.selectedOptions[0] ? chanSelect.selectedOptions[0].textContent.trim() : '# general';

    const maxUsesSelect = document.getElementById('create-invite-max-uses');
    const maxUsesText = maxUsesSelect ? maxUsesSelect.selectedOptions[0].textContent : 'Unlimited uses';

    const maxAgeSelect = document.getElementById('create-invite-max-age');
    const maxAgeText = maxAgeSelect ? maxAgeSelect.selectedOptions[0].textContent : 'Never';

    const previewUrl = document.getElementById('preview-url');
    const details = document.getElementById('preview-details');
    const previewLabel = document.getElementById('preview-label');

    if (previewUrl) previewUrl.textContent = 'discord.gg/invite';
    if (details) {
      details.textContent = `Destination: ${chanText} · ${maxUsesText} · Expires: ${maxAgeText}`;
    }
    if (previewLabel) {
      previewLabel.textContent = labelVal || 'None';
    }
  }

  async submitCreateInvite() {
    if (!this.currentGuildId) return;

    const channelId = document.getElementById('create-invite-channel').value;
    const label = document.getElementById('create-invite-label').value.trim();
    const maxAge = document.getElementById('create-invite-max-age').value;
    const maxUses = document.getElementById('create-invite-max-uses').value;
    const temporary = document.getElementById('create-invite-temp').checked;

    const submitBtn = document.getElementById('btn-submit-create-invite');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
    }

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites`, {
        method: 'POST',
        body: {
          channelId,
          label,
          maxAge: parseInt(maxAge, 10) || 0,
          maxUses: parseInt(maxUses, 10) || 0,
          temporary
        }
      });

      if (data.success && data.invite) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(data.invite.url);
        }
        const parts = [{ text: 'Created invite ' }, { code: data.invite.code }];
        if (data.invite.label) parts.push({ text: ` (${data.invite.label})` });
        parts.push({ text: ' and copied to clipboard.' });
        window.Mochi.showToast(parts, 'success');
        this.closeCreateInviteModal();
        await this.fetchActiveCodes();
      } else {
        window.Mochi.showToast('Could not create invite: ' + (data.message || 'Unknown error'), 'leave');
      }
    } catch (err) {
      console.error('Error creating invite:', err);
      window.Mochi.showToast(err.status === 403 ? 'You do not have permission to create invites.' : 'Network error creating invite.', 'leave');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create invite';
      }
    }
  }

  openEditLabelModal(code) {
    this.editingInviteCode = code;
    const invite = this.activeCodes.find(i => i.code === code);
    const currentLabel = invite?.label || '';

    const codeDisplay = document.getElementById('edit-modal-code-display');
    const input = document.getElementById('edit-label-input');
    if (codeDisplay) codeDisplay.textContent = `discord.gg/${code}`;
    if (input) input.value = currentLabel;

    const modal = document.getElementById('edit-label-modal');
    if (modal) modal.classList.add('active');
    if (input) input.focus();
  }

  closeEditLabelModal() {
    this.editingInviteCode = null;
    const modal = document.getElementById('edit-label-modal');
    if (modal) modal.classList.remove('active');
  }

  async submitEditLabel() {
    if (!this.currentGuildId || !this.editingInviteCode) return;

    const label = document.getElementById('edit-label-input').value.trim();

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/${this.editingInviteCode}/label`, {
        method: 'POST',
        body: { label }
      });
      if (data.success) {
        const parts = [
          { text: 'Label updated for ' },
          { code: this.editingInviteCode },
          { text: label ? `: ${label}` : ': removed.' }
        ];
        window.Mochi.showToast(parts, 'success');
        this.closeEditLabelModal();
        await this.fetchActiveCodes();
      }
    } catch (err) {
      console.error('Error updating label:', err);
      window.Mochi.showToast('Could not update label.', 'leave');
    }
  }

  async removeInviteLabel() {
    if (!this.currentGuildId || !this.editingInviteCode) return;

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/${this.editingInviteCode}/label`, {
        method: 'DELETE'
      });
      if (data.success) {
        window.Mochi.showToast([{ text: 'Label removed from ' }, { code: this.editingInviteCode }], 'success');
        this.closeEditLabelModal();
        await this.fetchActiveCodes();
      }
    } catch (err) {
      console.error('Error removing label:', err);
      window.Mochi.showToast('Could not remove label.', 'leave');
    }
  }

  async deleteInvite(code) {
    if (!confirm(`Delete invite discord.gg/${code}? This cannot be undone.`)) {
      return;
    }

    try {
      const data = await apiFetch(`/api/guilds/${this.currentGuildId}/invites/${code}`, {
        method: 'DELETE'
      });
      if (data.success) {
        window.Mochi.showToast([{ text: 'Revoked invite ' }, { code }], 'success');
        await this.fetchActiveCodes();
      } else {
        window.Mochi.showToast('Could not revoke invite.', 'leave');
      }
    } catch (err) {
      console.error('Error revoking invite:', err);
      window.Mochi.showToast('Network error revoking invite.', 'leave');
    }
  }
}

window.codesPage = new CodesPage();
