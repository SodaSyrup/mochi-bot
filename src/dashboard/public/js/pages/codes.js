/**
 * 🍡 Active Codes & Labels Page Script
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
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites/active-codes`);
      const data = await res.json();
      this.activeCodes = data.invites || [];
      this.renderCodesTable();
    } catch (e) {
      console.error('Error fetching active codes:', e);
    }
  }

  async fetchChannels() {
    if (!this.currentGuildId) return;

    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}/channels`);
      const data = await res.json();
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
    document.querySelectorAll('.filter-btn').forEach(btn => {
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

    // Apply Filter Tab
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
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 30px;">
        <i class="fa-solid fa-link-slash" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.4;"></i>
        No invite codes match your criteria. Click <b>"Create Invite"</b> to generate one!
      </td></tr>`;
      return;
    }

    list.forEach(inv => {
      const tr = document.createElement('tr');
      const hasLabel = Boolean(inv.label && inv.label.trim());

      // Label column HTML
      let labelHtml = '';
      if (hasLabel) {
        labelHtml = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge-label"><i class="fa-solid fa-tag"></i> ${inv.label}</span>
            <button class="icon-btn purple" title="Edit Label" onclick="codesPage.openEditLabelModal('${inv.code}', '${encodeURIComponent(inv.label)}')">
              <i class="fa-solid fa-pen" style="font-size: 11px;"></i>
            </button>
          </div>
        `;
      } else {
        labelHtml = `
          <button class="badge-unlabeled" onclick="codesPage.openEditLabelModal('${inv.code}', '')">
            <i class="fa-solid fa-plus"></i> Add Label
          </button>
        `;
      }

      // Channel column HTML
      const chanName = inv.channelName || (inv.channelId ? inv.channelId.replace('chan_', '') : 'general');
      const channelHtml = `<span class="badge-channel"><i class="fa-solid fa-hashtag"></i> ${chanName}</span>`;

      // Uses / Limit
      const usesCount = inv.uses || 0;
      const maxUsesText = inv.maxUses > 0 ? `/ ${inv.maxUses}` : '(Unlimited)';
      const usesBadgeClass = usesCount > 0 ? 'regular' : 'bonus';

      // Creator
      const creatorName = inv.inviter?.username || inv.inviterId || 'Server';

      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <a href="https://discord.gg/${inv.code}" target="_blank" style="font-family: var(--font-mono); font-weight: 600; color: #fff; text-decoration: none;">
              discord.gg/${inv.code}
            </a>
            <button class="icon-btn" title="Copy Link" onclick="navigator.clipboard.writeText('https://discord.gg/${inv.code}'); window.Mochi.showToast('Copied invite link: https://discord.gg/${inv.code}', 'success');">
              <i class="fa-solid fa-copy" style="font-size: 11px;"></i>
            </button>
          </div>
        </td>
        <td>${labelHtml}</td>
        <td>${channelHtml}</td>
        <td>
          <span class="badge-tag ${usesBadgeClass}">
            <b>${usesCount}</b> ${maxUsesText}
          </span>
        </td>
        <td>
          <div style="font-size: 13px; font-weight: 600; color: var(--text-muted);">
            <i class="fa-solid fa-user-astronaut" style="color: var(--accent-purple); margin-right: 4px;"></i> ${creatorName}
          </div>
        </td>
        <td style="text-align: right;">
          <div class="action-btn-group">
            <button class="btn btn-secondary btn-sm" onclick="codesPage.openEditLabelModal('${inv.code}', '${encodeURIComponent(inv.label || '')}')">
              <i class="fa-solid fa-tag"></i> Label
            </button>
            <button class="icon-btn danger" title="Revoke Invite" onclick="codesPage.deleteInvite('${inv.code}')">
              <i class="fa-solid fa-trash-can" style="font-size: 12px;"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
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
  }

  closeCreateInviteModal() {
    const modal = document.getElementById('create-invite-modal');
    if (modal) modal.classList.remove('active');
  }

  setLabelSuggestion(text) {
    const input = document.getElementById('create-invite-label');
    if (input) {
      input.value = text;
      this.updatePreview();
    }
  }

  updatePreview() {
    const labelInput = document.getElementById('create-invite-label');
    const labelVal = labelInput ? labelInput.value.trim() : '';

    const chanSelect = document.getElementById('create-invite-channel');
    const chanText = chanSelect && chanSelect.selectedOptions[0] ? chanSelect.selectedOptions[0].textContent : '# general';

    const maxUsesSelect = document.getElementById('create-invite-max-uses');
    const maxUsesText = maxUsesSelect ? maxUsesSelect.selectedOptions[0].textContent : 'Unlimited uses';

    const maxAgeSelect = document.getElementById('create-invite-max-age');
    const maxAgeText = maxAgeSelect ? maxAgeSelect.selectedOptions[0].textContent : 'Never';

    const badgeContainer = document.getElementById('preview-badge-container');
    const details = document.getElementById('preview-details');

    if (details) {
      details.textContent = `Destination: ${chanText} • ${maxUsesText} • Expires: ${maxAgeText}`;
    }

    if (badgeContainer) {
      if (labelVal) {
        badgeContainer.innerHTML = `<span class="badge-label"><i class="fa-solid fa-tag"></i> ${labelVal}</span>`;
      } else {
        badgeContainer.innerHTML = `<span class="badge-unlabeled" style="pointer-events: none;">No Label</span>`;
      }
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
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;
    }

    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          label,
          maxAge: parseInt(maxAge, 10) || 0,
          maxUses: parseInt(maxUses, 10) || 0,
          temporary
        })
      });

      const data = await res.json();

      if (data.success && data.invite) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(data.invite.url);
        }
        window.Mochi.showToast(`🎉 Created invite <b>${data.invite.code}</b>${data.invite.label ? ` (🏷️ ${data.invite.label})` : ''} & copied to clipboard!`, 'success');
        this.closeCreateInviteModal();
        await this.fetchActiveCodes();
      } else {
        window.Mochi.showToast('Failed to create invite: ' + (data.message || 'Unknown error'), 'leave');
      }
    } catch (err) {
      console.error('Error creating invite:', err);
      window.Mochi.showToast('Network error creating invite', 'leave');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Create & Generate Invite`;
      }
    }
  }

  openEditLabelModal(code, currentLabelEncoded) {
    this.editingInviteCode = code;
    const currentLabel = decodeURIComponent(currentLabelEncoded || '');

    const codeDisplay = document.getElementById('edit-modal-code-display');
    const input = document.getElementById('edit-label-input');
    if (codeDisplay) codeDisplay.textContent = `discord.gg/${code}`;
    if (input) input.value = currentLabel;

    const modal = document.getElementById('edit-label-modal');
    if (modal) modal.classList.add('active');
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
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites/${this.editingInviteCode}/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });

      const data = await res.json();
      if (data.success) {
        window.Mochi.showToast(`🏷️ Label updated for <code>${this.editingInviteCode}</code>: ${label ? `<b>${label}</b>` : 'Removed'}`, 'success');
        this.closeEditLabelModal();
        await this.fetchActiveCodes();
      }
    } catch (err) {
      console.error('Error updating label:', err);
      window.Mochi.showToast('Failed to update label', 'leave');
    }
  }

  async removeInviteLabel() {
    if (!this.currentGuildId || !this.editingInviteCode) return;

    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites/${this.editingInviteCode}/label`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (data.success) {
        window.Mochi.showToast(`🗑️ Label removed from <code>${this.editingInviteCode}</code>`, 'success');
        this.closeEditLabelModal();
        await this.fetchActiveCodes();
      }
    } catch (err) {
      console.error('Error removing label:', err);
      window.Mochi.showToast('Failed to remove label', 'leave');
    }
  }

  async deleteInvite(code) {
    if (!confirm(`Are you sure you want to revoke and delete invite discord.gg/${code}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/guilds/${this.currentGuildId}/invites/${code}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (data.success) {
        window.Mochi.showToast(`🗑️ Revoked invite <code>${code}</code>`, 'success');
        await this.fetchActiveCodes();
      } else {
        window.Mochi.showToast('Failed to revoke invite', 'leave');
      }
    } catch (err) {
      console.error('Error revoking invite:', err);
      window.Mochi.showToast('Network error revoking invite', 'leave');
    }
  }
}

window.codesPage = new CodesPage();
