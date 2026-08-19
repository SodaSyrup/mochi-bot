/**
 * 🍡 Mochi Discord Safety & AutoMod Client Controller
 */

class SafetyPage {
  constructor() {
    this.rules = [];
    this.channels = [];
    this.roles = [];
    this.safetySettings = null;
    this.currentFilter = 'all';
    this.incidents = [];

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  async init() {
    if (window.Mochi) {
      window.Mochi.onGuildChange(() => this.refreshAll());
      window.Mochi.onRealtime('autoModExecution', (data) => this.handleAutoModExecution(data));
      window.Mochi.onRealtime('autoModRuleUpdated', (data) => this.handleRuleUpdated(data));
    }

    await this.refreshAll();
  }

  getGuildId() {
    return window.Mochi?.currentGuildId || '999888777666555444';
  }

  async refreshAll() {
    const guildId = this.getGuildId();
    await Promise.all([
      this.loadSafetySettings(guildId),
      this.loadChannels(guildId),
      this.loadRoles(guildId),
      this.loadRules(guildId)
    ]);
  }

  async loadSafetySettings(guildId) {
    try {
      const res = await fetch(`/api/guilds/${guildId}/safety`);
      if (!res.ok) throw new Error('Failed to load safety settings');
      const data = await res.json();
      this.safetySettings = data.safety;
      this.renderSafetySettings(data.safety);
    } catch (err) {
      console.error('[Safety] Error loading safety settings:', err);
    }
  }

  renderSafetySettings(safety) {
    if (!safety) return;

    // Stat cards
    const verLevels = ['None', 'Low (Email)', 'Medium (5m)', 'High (10m)', 'Highest (Phone)'];
    const explicitLevels = ["Don't Scan", 'No Roles Only', 'All Members'];

    const verEl = document.getElementById('stat-verification-text');
    if (verEl) verEl.textContent = verLevels[safety.verificationLevel] || 'Low (Email)';

    const expEl = document.getElementById('stat-explicit-text');
    if (expEl) expEl.textContent = explicitLevels[safety.explicitContentFilter] || 'No Roles Only';

    const sourceEl = document.getElementById('stat-source-truth');
    if (sourceEl) {
      sourceEl.textContent = safety.isSimulated ? 'Source: Sandbox Simulator' : 'Source: Discord Gateway';
    }

    // Form inputs
    const setVer = document.getElementById('setting-verification-level');
    if (setVer) setVer.value = safety.verificationLevel ?? 1;

    const setExp = document.getElementById('setting-explicit-filter');
    if (setExp) setExp.value = safety.explicitContentFilter ?? 1;

    const setNotif = document.getElementById('setting-notifications');
    if (setNotif) setNotif.value = safety.defaultMessageNotifications ?? 1;
  }

  async saveSafetySettings(e) {
    if (e) e.preventDefault();
    const guildId = this.getGuildId();
    const btn = document.getElementById('btn-save-safety');
    if (btn) btn.disabled = true;

    try {
      const verificationLevel = parseInt(document.getElementById('setting-verification-level').value, 10);
      const explicitContentFilter = parseInt(document.getElementById('setting-explicit-filter').value, 10);
      const defaultMessageNotifications = parseInt(document.getElementById('setting-notifications').value, 10);
      const safetyAlertsChannelId = document.getElementById('setting-safety-channel').value || null;

      const res = await fetch(`/api/guilds/${guildId}/safety/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationLevel,
          explicitContentFilter,
          defaultMessageNotifications,
          safetyAlertsChannelId
        })
      });

      if (!res.ok) throw new Error('Failed to update server safety settings');
      const data = await res.json();
      this.safetySettings = data.safety;
      this.renderSafetySettings(data.safety);

      if (window.Mochi) {
        window.Mochi.showToast('🛡️ Discord server security settings updated successfully!', 'success');
      }
    } catch (err) {
      console.error('[Safety] Error saving settings:', err);
      if (window.Mochi) {
        window.Mochi.showToast('❌ Failed to update settings on Discord.', 'leave');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async loadChannels(guildId) {
    try {
      const res = await fetch(`/api/guilds/${guildId}/channels`);
      if (!res.ok) return;
      const data = await res.json();
      this.channels = data.channels || [];
      this.populateChannelSelects();
    } catch (err) {
      console.error('[Safety] Error loading channels:', err);
    }
  }

  populateChannelSelects() {
    const safetyChannelSelect = document.getElementById('setting-safety-channel');
    const alertChannelSelect = document.getElementById('rule-alert-channel');
    const exemptChannelSelect = document.getElementById('rule-exempt-channels');

    if (safetyChannelSelect) {
      const currentVal = this.safetySettings?.safetyAlertsChannelId || '';
      safetyChannelSelect.innerHTML = '<option value="">No Safety Channel Selected</option>' +
        this.channels.map(c => `<option value="${c.id}" ${c.id === currentVal ? 'selected' : ''}>#${c.name}</option>`).join('');
    }

    if (alertChannelSelect) {
      alertChannelSelect.innerHTML = '<option value="">Select alert channel...</option>' +
        this.channels.map(c => `<option value="${c.id}">#${c.name}</option>`).join('');
    }

    if (exemptChannelSelect) {
      exemptChannelSelect.innerHTML = this.channels.map(c => `<option value="${c.id}">#${c.name}</option>`).join('');
    }
  }

  async loadRoles(guildId) {
    try {
      const res = await fetch(`/api/guilds/${guildId}/roles`);
      if (!res.ok) return;
      const data = await res.json();
      this.roles = data.roles || [];
      this.populateRoleSelects();
    } catch (err) {
      console.error('[Safety] Error loading roles:', err);
    }
  }

  populateRoleSelects() {
    const exemptRoleSelect = document.getElementById('rule-exempt-roles');
    if (exemptRoleSelect) {
      exemptRoleSelect.innerHTML = this.roles.map(r => `<option value="${r.id}">@${r.name}</option>`).join('');
    }
  }

  async loadRules(guildId) {
    const container = document.getElementById('automod-rules-container');
    try {
      const res = await fetch(`/api/guilds/${guildId}/safety/automod`);
      if (!res.ok) throw new Error('Failed to fetch AutoMod rules');
      const data = await res.json();
      this.rules = data.rules || [];
      this.updateRuleCounts();
      this.renderRules();
    } catch (err) {
      console.error('[Safety] Error loading AutoMod rules:', err);
      if (container) {
        container.innerHTML = `<div class="error-msg" style="padding: 24px; text-align: center; color: var(--accent-pink);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading rules from Discord.</div>`;
      }
    }
  }

  updateRuleCounts() {
    const total = this.rules.length;
    const active = this.rules.filter(r => r.enabled).length;

    const totalEl = document.getElementById('stat-total-rules');
    if (totalEl) totalEl.textContent = total;

    const activeEl = document.getElementById('stat-active-rules');
    if (activeEl) activeEl.textContent = `${active} active on server`;

    const countAll = document.getElementById('count-filter-all');
    if (countAll) countAll.textContent = total;

    const countKw = document.getElementById('count-filter-keyword');
    if (countKw) countKw.textContent = this.rules.filter(r => r.triggerType === 1 || r.triggerType === 6).length;

    const countSpam = document.getElementById('count-filter-spam');
    if (countSpam) countSpam.textContent = this.rules.filter(r => r.triggerType === 3).length;

    const countMention = document.getElementById('count-filter-mention');
    if (countMention) countMention.textContent = this.rules.filter(r => r.triggerType === 5).length;

    const countPreset = document.getElementById('count-filter-preset');
    if (countPreset) countPreset.textContent = this.rules.filter(r => r.triggerType === 4).length;
  }

  filterRules(type, btn) {
    this.currentFilter = type;
    document.querySelectorAll('.rules-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.renderRules();
  }

  renderRules() {
    const container = document.getElementById('automod-rules-container');
    if (!container) return;

    let filtered = this.rules;
    if (this.currentFilter === 'keyword') {
      filtered = this.rules.filter(r => r.triggerType === 1 || r.triggerType === 6);
    } else if (this.currentFilter === 'spam') {
      filtered = this.rules.filter(r => r.triggerType === 3);
    } else if (this.currentFilter === 'mention') {
      filtered = this.rules.filter(r => r.triggerType === 5);
    } else if (this.currentFilter === 'preset') {
      filtered = this.rules.filter(r => r.triggerType === 4);
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-rules-state" style="text-align: center; padding: 48px 24px; grid-column: 1 / -1;">
          <div style="font-size: 40px; margin-bottom: 12px;">🛡️</div>
          <h4 style="font-size: 16px; font-weight: 600; color: var(--text-normal);">No AutoMod Rules Found</h4>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">No rules match the selected filter. Click "Create AutoMod Rule" to add one.</p>
        </div>
      `;
      return;
    }

    const triggerLabels = {
      1: { name: 'Keyword / URL', icon: 'fa-font', color: '#38bdf8' },
      3: { name: 'Discord Spam ML', icon: 'fa-envelope-open-text', color: '#f59e0b' },
      4: { name: 'Preset Words', icon: 'fa-shield-halved', color: '#a855f7' },
      5: { name: 'Mention Spam', icon: 'fa-at', color: '#ec4899' },
      6: { name: 'Member Profile', icon: 'fa-id-badge', color: '#10b981' }
    };

    container.innerHTML = filtered.map(rule => {
      const trigger = triggerLabels[rule.triggerType] || { name: 'Custom Trigger', icon: 'fa-gear', color: '#94a3b8' };
      const actionsList = rule.actions || [];
      const hasBlock = actionsList.some(a => a.type === 1);
      const hasAlert = actionsList.some(a => a.type === 2);
      const hasTimeout = actionsList.some(a => a.type === 3);
      const hasBlockProfile = actionsList.some(a => a.type === 4);

      let triggerDetailsHtml = '';
      if (rule.triggerType === 1 || rule.triggerType === 6) {
        const keywords = rule.triggerMetadata?.keywordFilter || [];
        const regexes = rule.triggerMetadata?.regexPatterns || [];
        triggerDetailsHtml = `
          <div class="rule-trigger-details">
            ${keywords.slice(0, 4).map(k => `<span class="tag-keyword"><code>${this.escapeHtml(k)}</code></span>`).join(' ')}
            ${keywords.length > 4 ? `<span class="tag-more">+${keywords.length - 4} more</span>` : ''}
            ${regexes.length > 0 ? `<span class="tag-regex"><i class="fa-solid fa-code"></i> ${regexes.length} Regex</span>` : ''}
          </div>
        `;
      } else if (rule.triggerType === 4) {
        const presets = rule.triggerMetadata?.presets || [];
        const presetNames = { 1: 'Profanity', 2: 'Sexual Content', 3: 'Slurs & Hate' };
        triggerDetailsHtml = `
          <div class="rule-trigger-details">
            ${presets.map(p => `<span class="tag-preset">${presetNames[p] || 'Preset ' + p}</span>`).join(' ')}
          </div>
        `;
      } else if (rule.triggerType === 5) {
        triggerDetailsHtml = `
          <div class="rule-trigger-details">
            <span class="tag-mention"><i class="fa-solid fa-triangle-exclamation"></i> Limit: &gt; ${rule.triggerMetadata?.mentionTotalLimit || 5} Mentions</span>
          </div>
        `;
      } else if (rule.triggerType === 3) {
        triggerDetailsHtml = `
          <div class="rule-trigger-details">
            <span class="tag-spam"><i class="fa-solid fa-robot"></i> Discord Automated Spam Detector</span>
          </div>
        `;
      }

      return `
        <div class="automod-card ${rule.enabled ? 'enabled' : 'disabled'}" id="rule-card-${rule.id}">
          <div class="automod-card-header">
            <div class="automod-title-block">
              <span class="trigger-type-badge" style="background: ${trigger.color}15; color: ${trigger.color}; border: 1px solid ${trigger.color}40;">
                <i class="fa-solid ${trigger.icon}"></i> ${trigger.name}
              </span>
              <h4 class="automod-rule-name">${this.escapeHtml(rule.name)}</h4>
            </div>

            <!-- Toggle Switch -->
            <label class="switch-toggle" title="${rule.enabled ? 'Click to disable' : 'Click to enable'}">
              <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="safetyPage.toggleRuleState('${rule.id}', this.checked)">
              <span class="slider"></span>
            </label>
          </div>

          ${triggerDetailsHtml}

          <!-- Actions Taken -->
          <div class="rule-actions-row">
            <span class="actions-label">Actions:</span>
            ${hasBlock ? '<span class="action-pill action-block"><i class="fa-solid fa-ban"></i> Block Message</span>' : ''}
            ${hasAlert ? '<span class="action-pill action-alert"><i class="fa-solid fa-bell"></i> Send Alert</span>' : ''}
            ${hasTimeout ? '<span class="action-pill action-timeout"><i class="fa-solid fa-clock"></i> Timeout</span>' : ''}
            ${hasBlockProfile ? '<span class="action-pill action-block"><i class="fa-solid fa-user-slash"></i> Block Update</span>' : ''}
          </div>

          <!-- Exemptions Footer -->
          <div class="automod-card-footer">
            <div class="exemptions-summary">
              <span><i class="fa-solid fa-user-shield"></i> ${(rule.exemptRoles || []).length} Roles</span>
              <span><i class="fa-solid fa-hashtag"></i> ${(rule.exemptChannels || []).length} Channels</span>
            </div>

            <div class="rule-btn-actions">
              <button class="btn-icon" title="Edit Rule" onclick="safetyPage.openEditModal('${rule.id}')"><i class="fa-solid fa-pen-to-square"></i></button>
              <button class="btn-icon delete" title="Delete Rule from Discord" onclick="safetyPage.deleteRule('${rule.id}')"><i class="fa-solid fa-trash-can"></i></button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async toggleRuleState(ruleId, enabled) {
    const guildId = this.getGuildId();
    try {
      const res = await fetch(`/api/guilds/${guildId}/safety/automod/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (!res.ok) throw new Error('Failed to toggle rule');
      const data = await res.json();
      
      const idx = this.rules.findIndex(r => r.id === ruleId);
      if (idx !== -1) {
        this.rules[idx] = data.rule;
      }
      this.updateRuleCounts();

      const card = document.getElementById(`rule-card-${ruleId}`);
      if (card) {
        if (enabled) {
          card.classList.remove('disabled');
          card.classList.add('enabled');
        } else {
          card.classList.remove('enabled');
          card.classList.add('disabled');
        }
      }

      if (window.Mochi) {
        window.Mochi.showToast(enabled ? '🛡️ AutoMod rule enabled on Discord!' : '⚠️ AutoMod rule disabled on Discord.', enabled ? 'join' : 'leave');
      }
    } catch (err) {
      console.error('[Safety] Error toggling rule state:', err);
      if (window.Mochi) {
        window.Mochi.showToast('❌ Failed to toggle rule state on Discord.', 'leave');
      }
      await this.loadRules(guildId);
    }
  }

  async deleteRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    const ruleName = rule ? rule.name : 'this rule';

    if (!confirm(`Are you sure you want to permanently delete "${ruleName}" from Discord?`)) {
      return;
    }

    const guildId = this.getGuildId();
    try {
      const res = await fetch(`/api/guilds/${guildId}/safety/automod/${ruleId}`, {
        method: 'DELETE'
      });

      if (!res.ok) throw new Error('Failed to delete rule');
      this.rules = this.rules.filter(r => r.id !== ruleId);
      this.updateRuleCounts();
      this.renderRules();

      if (window.Mochi) {
        window.Mochi.showToast(`🗑️ Rule "${ruleName}" deleted from Discord.`, 'leave');
      }
    } catch (err) {
      console.error('[Safety] Error deleting rule:', err);
      if (window.Mochi) {
        window.Mochi.showToast('❌ Failed to delete rule from Discord.', 'leave');
      }
    }
  }

  openCreateModal() {
    document.getElementById('rule-edit-id').value = '';
    document.getElementById('rule-modal-title').innerHTML = '<i class="fa-solid fa-shield-plus" style="color: var(--accent-pink);"></i> Create AutoMod Rule';
    document.getElementById('rule-name').value = '';
    document.getElementById('rule-trigger-type').value = '1';
    this.onTriggerTypeChange('1');

    document.getElementById('rule-keywords').value = '';
    document.getElementById('rule-regex').value = '';
    document.getElementById('rule-allowlist').value = '';

    document.getElementById('preset-profanity').checked = true;
    document.getElementById('preset-sexual').checked = true;
    document.getElementById('preset-slurs').checked = true;

    document.getElementById('rule-mention-limit').value = 5;

    document.getElementById('action-block').checked = true;
    this.toggleActionBlock(true);
    document.getElementById('action-alert').checked = false;
    this.toggleActionAlert(false);
    document.getElementById('action-timeout').checked = false;
    this.toggleActionTimeout(false);

    document.getElementById('rule-custom-message').value = '';
    document.getElementById('rule-enabled').checked = true;

    // Reset selects
    const exemptRoles = document.getElementById('rule-exempt-roles');
    if (exemptRoles) Array.from(exemptRoles.options).forEach(o => o.selected = false);

    const exemptChannels = document.getElementById('rule-exempt-channels');
    if (exemptChannels) Array.from(exemptChannels.options).forEach(o => o.selected = false);

    document.getElementById('rule-modal').classList.add('active');
  }

  openEditModal(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return;

    document.getElementById('rule-edit-id').value = rule.id;
    document.getElementById('rule-modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square" style="color: var(--accent-purple);"></i> Edit AutoMod Rule`;
    document.getElementById('rule-name').value = rule.name;
    document.getElementById('rule-trigger-type').value = rule.triggerType;
    this.onTriggerTypeChange(rule.triggerType);

    if (rule.triggerType === 1 || rule.triggerType === 6) {
      document.getElementById('rule-keywords').value = (rule.triggerMetadata?.keywordFilter || []).join(', ');
      document.getElementById('rule-regex').value = (rule.triggerMetadata?.regexPatterns || []).join('\n');
      document.getElementById('rule-allowlist').value = (rule.triggerMetadata?.allowList || []).join(', ');
    } else if (rule.triggerType === 4) {
      const presets = rule.triggerMetadata?.presets || [];
      document.getElementById('preset-profanity').checked = presets.includes(1);
      document.getElementById('preset-sexual').checked = presets.includes(2);
      document.getElementById('preset-slurs').checked = presets.includes(3);
    } else if (rule.triggerType === 5) {
      document.getElementById('rule-mention-limit').value = rule.triggerMetadata?.mentionTotalLimit || 5;
    }

    const actions = rule.actions || [];
    const blockAct = actions.find(a => a.type === 1);
    const alertAct = actions.find(a => a.type === 2);
    const timeoutAct = actions.find(a => a.type === 3);

    document.getElementById('action-block').checked = Boolean(blockAct);
    this.toggleActionBlock(Boolean(blockAct));
    if (blockAct) {
      document.getElementById('rule-custom-message').value = blockAct.metadata?.customMessage || '';
    }

    document.getElementById('action-alert').checked = Boolean(alertAct);
    this.toggleActionAlert(Boolean(alertAct));
    if (alertAct) {
      document.getElementById('rule-alert-channel').value = alertAct.metadata?.channelId || '';
    }

    document.getElementById('action-timeout').checked = Boolean(timeoutAct);
    this.toggleActionTimeout(Boolean(timeoutAct));
    if (timeoutAct) {
      document.getElementById('rule-timeout-duration').value = timeoutAct.metadata?.durationSeconds || 300;
    }

    document.getElementById('rule-enabled').checked = Boolean(rule.enabled);

    // Exempt roles
    const exemptRoles = document.getElementById('rule-exempt-roles');
    if (exemptRoles) {
      Array.from(exemptRoles.options).forEach(o => {
        o.selected = (rule.exemptRoles || []).includes(o.value);
      });
    }

    // Exempt channels
    const exemptChannels = document.getElementById('rule-exempt-channels');
    if (exemptChannels) {
      Array.from(exemptChannels.options).forEach(o => {
        o.selected = (rule.exemptChannels || []).includes(o.value);
      });
    }

    document.getElementById('rule-modal').classList.add('active');
  }

  closeRuleModal() {
    document.getElementById('rule-modal').classList.remove('active');
  }

  onTriggerTypeChange(val) {
    const type = parseInt(val, 10);
    const kwSection = document.getElementById('trigger-config-keyword');
    const presetSection = document.getElementById('trigger-config-preset');
    const mentionSection = document.getElementById('trigger-config-mention');

    if (kwSection) kwSection.style.display = (type === 1 || type === 6) ? 'block' : 'none';
    if (presetSection) presetSection.style.display = (type === 4) ? 'block' : 'none';
    if (mentionSection) mentionSection.style.display = (type === 5) ? 'block' : 'none';
  }

  toggleActionBlock(checked) {
    const el = document.getElementById('action-block-config');
    if (el) el.style.display = checked ? 'block' : 'none';
  }

  toggleActionAlert(checked) {
    const el = document.getElementById('action-alert-config');
    if (el) el.style.display = checked ? 'block' : 'none';
  }

  toggleActionTimeout(checked) {
    const el = document.getElementById('action-timeout-config');
    if (el) el.style.display = checked ? 'block' : 'none';
  }

  async submitRuleForm(e) {
    e.preventDefault();
    const guildId = this.getGuildId();
    const editId = document.getElementById('rule-edit-id').value;
    const isEdit = Boolean(editId);
    const btn = document.getElementById('btn-save-rule');
    if (btn) btn.disabled = true;

    try {
      const name = document.getElementById('rule-name').value.trim();
      const triggerType = parseInt(document.getElementById('rule-trigger-type').value, 10);
      const enabled = document.getElementById('rule-enabled').checked;
      const eventType = (triggerType === 6) ? 2 : 1;

      // Trigger Metadata
      const triggerMetadata = {};
      if (triggerType === 1 || triggerType === 6) {
        const rawKeywords = document.getElementById('rule-keywords').value;
        triggerMetadata.keywordFilter = rawKeywords.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        const rawRegex = document.getElementById('rule-regex').value;
        triggerMetadata.regexPatterns = rawRegex.split('\n').map(s => s.trim()).filter(Boolean);
        const rawAllow = document.getElementById('rule-allowlist').value;
        triggerMetadata.allowList = rawAllow.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      } else if (triggerType === 4) {
        const presets = [];
        if (document.getElementById('preset-profanity').checked) presets.push(1);
        if (document.getElementById('preset-sexual').checked) presets.push(2);
        if (document.getElementById('preset-slurs').checked) presets.push(3);
        triggerMetadata.presets = presets;
      } else if (triggerType === 5) {
        triggerMetadata.mentionTotalLimit = parseInt(document.getElementById('rule-mention-limit').value || 5, 10);
        triggerMetadata.mentionRaidProtectionEnabled = true;
      }

      // Actions
      const actions = [];
      if (document.getElementById('action-block').checked) {
        const customMessage = document.getElementById('rule-custom-message').value.trim();
        actions.push({
          type: (triggerType === 6) ? 4 : 1,
          metadata: customMessage ? { customMessage } : {}
        });
      }

      if (document.getElementById('action-alert').checked) {
        const channelId = document.getElementById('rule-alert-channel').value;
        if (channelId) {
          actions.push({
            type: 2,
            metadata: { channelId }
          });
        }
      }

      if (document.getElementById('action-timeout').checked) {
        const durationSeconds = parseInt(document.getElementById('rule-timeout-duration').value || 300, 10);
        actions.push({
          type: 3,
          metadata: { durationSeconds }
        });
      }

      // Exemptions
      const exemptRolesSelect = document.getElementById('rule-exempt-roles');
      const exemptRoles = Array.from(exemptRolesSelect.selectedOptions).map(o => o.value);

      const exemptChannelsSelect = document.getElementById('rule-exempt-channels');
      const exemptChannels = Array.from(exemptChannelsSelect.selectedOptions).map(o => o.value);

      const payload = {
        name,
        eventType,
        triggerType,
        triggerMetadata,
        actions,
        exemptRoles,
        exemptChannels,
        enabled
      };

      const url = isEdit ? `/api/guilds/${guildId}/safety/automod/${editId}` : `/api/guilds/${guildId}/safety/automod`;
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save rule on Discord');
      }

      const data = await res.json();
      this.closeRuleModal();

      if (isEdit) {
        const idx = this.rules.findIndex(r => r.id === editId);
        if (idx !== -1) this.rules[idx] = data.rule;
      } else {
        this.rules.unshift(data.rule);
      }

      this.updateRuleCounts();
      this.renderRules();

      if (window.Mochi) {
        window.Mochi.showToast(isEdit ? `✨ AutoMod rule "${name}" updated on Discord!` : `🎉 AutoMod rule "${name}" created on Discord!`, 'success');
      }
    } catch (err) {
      console.error('[Safety] Error saving rule:', err);
      if (window.Mochi) {
        window.Mochi.showToast(`❌ Error: ${err.message}`, 'leave');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  handleAutoModExecution(data) {
    console.log('[Safety] Real-time AutoMod incident received:', data);
    this.incidents.unshift(data);
    if (this.incidents.length > 20) this.incidents.pop();
    this.renderIncidentFeed();

    const actionText = (data.action?.type === 3) ? 'Timed Out (Mute)' : (data.action?.type === 2 ? 'Alerted' : 'Blocked Message');
    if (window.Mochi) {
      window.Mochi.showToast(
        `🚨 <b>AutoMod Interception:</b> User <code>${data.user?.username || data.userId}</code> triggered <b>${data.ruleName || 'AutoMod Rule'}</b> in #${data.channelName || 'chat'}. Action: <b>${actionText}</b>`,
        'leave'
      );
    }
  }

  handleRuleUpdated(data) {
    console.log('[Safety] AutoMod rule updated remotely:', data);
    const guildId = this.getGuildId();
    this.loadRules(guildId);
  }

  renderIncidentFeed() {
    const container = document.getElementById('incident-feed-list');
    if (!container) return;

    if (this.incidents.length === 0) {
      container.innerHTML = `
        <div class="feed-empty-state" id="feed-empty-msg">
          <i class="fa-solid fa-shield-check" style="font-size: 32px; color: var(--accent-emerald); margin-bottom: 8px;"></i>
          <div>All systems secure. No recent infractions recorded.</div>
          <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">Click "Test Trigger" to test a live violation.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = this.incidents.map(inc => {
      const timeStr = new Date(inc.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const actionType = inc.action?.type || 1;
      const actionLabels = {
        1: { name: 'Blocked', color: '#f43f5e', icon: 'fa-ban' },
        2: { name: 'Alerted', color: '#f59e0b', icon: 'fa-bell' },
        3: { name: `Timed Out (${inc.action?.metadata?.durationSeconds ? inc.action.metadata.durationSeconds + 's' : '5m'})`, color: '#ec4899', icon: 'fa-clock' },
        4: { name: 'Profile Blocked', color: '#8b5cf6', icon: 'fa-user-slash' }
      };
      const act = actionLabels[actionType] || actionLabels[1];

      return `
        <div class="incident-item">
          <div class="incident-avatar">
            <img src="${inc.user?.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="Avatar">
          </div>
          <div class="incident-details">
            <div class="incident-header">
              <span class="incident-user">${this.escapeHtml(inc.user?.username || 'Unknown User')}</span>
              <span class="incident-channel">#${this.escapeHtml(inc.channelName || 'general')}</span>
              <span class="incident-time">${timeStr}</span>
            </div>
            <div class="incident-content">
              "${this.escapeHtml(inc.content || 'Offensive content')}"
            </div>
            <div class="incident-meta">
              <span class="incident-tag" style="background: ${act.color}20; color: ${act.color};">
                <i class="fa-solid ${act.icon}"></i> ${act.name}
              </span>
              ${inc.matchedKeyword ? `<span class="incident-matched">Matched: <code>${this.escapeHtml(inc.matchedKeyword)}</code></span>` : ''}
              <span class="incident-rule">${this.escapeHtml(inc.ruleName || 'AutoMod')}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async simulateIncident() {
    const guildId = this.getGuildId();
    const testOffenses = [
      {
        ruleName: '🛡️ Block Scam Links & Malicious URLs',
        triggerType: 1,
        content: 'Claim Free Discord Nitro 1-Year gift at https://discord-nitro-event.ru/claim!',
        matchedKeyword: 'discord-nitro-event.ru',
        actionType: 1
      },
      {
        ruleName: '🚫 Anti-Spam & Severe Profanity Filter',
        triggerType: 4,
        content: 'Profanity test violation against server safety policy.',
        matchedKeyword: 'inappropriate words',
        actionType: 3,
        timeoutSeconds: 300
      },
      {
        ruleName: '⚡ Anti-Mention Raid Protection (Limit 5)',
        triggerType: 5,
        content: '@user1 @user2 @user3 @user4 @user5 @user6 check this out guys!!',
        matchedKeyword: '> 5 mentions',
        actionType: 1
      }
    ];

    const pick = testOffenses[Math.floor(Math.random() * testOffenses.length)];

    try {
      const res = await fetch(`/api/guilds/${guildId}/simulate/automod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleName: pick.ruleName,
          triggerType: pick.triggerType,
          username: 'TestViolator_' + Math.floor(Math.random() * 900 + 100),
          channelName: 'general-chat',
          content: pick.content,
          matchedKeyword: pick.matchedKeyword,
          actionType: pick.actionType,
          timeoutSeconds: pick.timeoutSeconds || 300
        })
      });

      if (!res.ok) throw new Error('Simulation failed');
      const data = await res.json();
      console.log('[Safety Simulator] Triggered test incident:', data);
    } catch (err) {
      console.error('[Safety Simulator] Error:', err);
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

window.safetyPage = new SafetyPage();
