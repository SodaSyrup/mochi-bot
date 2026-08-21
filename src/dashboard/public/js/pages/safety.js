const AUTO_MOD = window.MochiConstants.autoMod;

/**
 * Mochi Discord Safety & AutoMod Client Controller
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
      window.Mochi.onRealtime('autoModRuleUpdated', () => this.loadRules(this.getGuildId()));
    }

    window.addEventListener('mochi:close-modals', () => this.closeRuleModal());

    await this.refreshAll();
  }

  getGuildId() {
    return window.Mochi?.currentGuildId;
  }

  async refreshAll() {
    const guildId = this.getGuildId();
    if (!guildId) return;
    await Promise.all([
      this.loadSafetySettings(guildId),
      this.loadChannels(guildId),
      this.loadRoles(guildId),
      this.loadRules(guildId)
    ]);
  }

  async loadSafetySettings(guildId) {
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/safety`);
      this.safetySettings = data.safety;
      this.renderSafetySettings(data.safety);
    } catch (err) {
      console.error('[Safety] Error loading safety settings:', err);
    }
  }

  renderSafetySettings(safety) {
    if (!safety) return;

    const verLevels = ['None', 'Low', 'Medium', 'High', 'Highest'];
    const explicitLevels = ["Don't scan", 'Members without roles', 'All members'];

    const totalEl = document.getElementById('stat-total-rules');
    if (totalEl) totalEl.textContent = safety.rulesCount ?? 0;

    const activeEl = document.getElementById('stat-active-rules');
    if (activeEl) activeEl.textContent = `${safety.enabledRulesCount ?? 0} active`;

    const verEl = document.getElementById('stat-verification-text');
    if (verEl) verEl.textContent = verLevels[safety.verificationLevel] || 'Low';

    const expEl = document.getElementById('stat-explicit-text');
    if (expEl) expEl.textContent = explicitLevels[safety.explicitContentFilter] || 'Members without roles';

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
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }

    try {
      const verificationLevel = parseInt(document.getElementById('setting-verification-level').value, 10);
      const explicitContentFilter = parseInt(document.getElementById('setting-explicit-filter').value, 10);
      const defaultMessageNotifications = parseInt(document.getElementById('setting-notifications').value, 10);
      const safetyAlertsChannelId = document.getElementById('setting-safety-channel').value || null;

      const data = await apiFetch(`/api/guilds/${guildId}/safety/settings`, {
        method: 'PATCH',
        body: {
          verificationLevel,
          explicitContentFilter,
          defaultMessageNotifications,
          safetyAlertsChannelId
        }
      });
      this.safetySettings = data.safety;
      this.renderSafetySettings(data.safety);

      if (window.Mochi) {
        window.Mochi.showToast('Server settings updated.', 'success');
      }
    } catch (err) {
      console.error('[Safety] Error saving settings:', err);
      if (window.Mochi) {
        window.Mochi.showToast('Could not update server settings.', 'leave');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save changes';
      }
    }
  }

  async loadChannels(guildId) {
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/channels`);
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
      safetyChannelSelect.innerHTML = '<option value="">No safety channel selected</option>' +
        this.channels.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === currentVal ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
    }

    if (alertChannelSelect) {
      alertChannelSelect.innerHTML = '<option value="">Select channel…</option>' +
        this.channels.map(c => `<option value="${escapeHtml(c.id)}">#${escapeHtml(c.name)}</option>`).join('');
    }

    if (exemptChannelSelect) {
      exemptChannelSelect.innerHTML = this.channels.map(c => `<option value="${escapeHtml(c.id)}">#${escapeHtml(c.name)}</option>`).join('');
    }
  }

  async loadRoles(guildId) {
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/roles`);
      this.roles = data.roles || [];
      this.populateRoleSelects();
    } catch (err) {
      console.error('[Safety] Error loading roles:', err);
    }
  }

  populateRoleSelects() {
    const exemptRoleSelect = document.getElementById('rule-exempt-roles');
    if (exemptRoleSelect) {
      exemptRoleSelect.innerHTML = this.roles.map(r => `<option value="${escapeHtml(r.id)}">@${escapeHtml(r.name)}</option>`).join('');
    }
  }

  async loadRules(guildId) {
    if (!guildId) return;
    const container = document.getElementById('automod-rules-container');
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/safety/automod`);
      this.rules = data.rules || [];
      this.updateRuleCounts();
      this.renderRules();
    } catch (err) {
      console.error('[Safety] Error loading AutoMod rules:', err);
      if (container) {
        container.innerHTML = `<div class="empty-state">Could not load AutoMod rules.</div>`;
      }
    }
  }

  updateRuleCounts() {
    const total = this.rules.length;
    const active = this.rules.filter(r => r.enabled).length;

    const totalEl = document.getElementById('stat-total-rules');
    if (totalEl) totalEl.textContent = total;

    const activeEl = document.getElementById('stat-active-rules');
    if (activeEl) activeEl.textContent = `${active} active`;

    const countAll = document.getElementById('count-filter-all');
    if (countAll) countAll.textContent = total;

    const countKw = document.getElementById('count-filter-keyword');
    if (countKw) countKw.textContent = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerKeyword || r.triggerType === AUTO_MOD.triggerMemberProfile).length;

    const countSpam = document.getElementById('count-filter-spam');
    if (countSpam) countSpam.textContent = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerSpam).length;

    const countMention = document.getElementById('count-filter-mention');
    if (countMention) countMention.textContent = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerMentionSpam).length;

    const countPreset = document.getElementById('count-filter-preset');
    if (countPreset) countPreset.textContent = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerKeywordPreset).length;
  }

  filterRules(type, btn) {
    this.currentFilter = type;
    document.querySelectorAll('#rules-filter-bar .seg-btn').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.renderRules();
  }

  triggerLabel(type) {
    const labels = {
      [AUTO_MOD.triggerKeyword]: 'Keywords',
      [AUTO_MOD.triggerSpam]: 'Spam',
      [AUTO_MOD.triggerKeywordPreset]: 'Presets',
      [AUTO_MOD.triggerMentionSpam]: 'Mentions',
      [AUTO_MOD.triggerMemberProfile]: 'Member profile'
    };
    return labels[type] || 'Custom';
  }

  renderRules() {
    const container = document.getElementById('automod-rules-container');
    if (!container) return;

    let filtered = this.rules;
    if (this.currentFilter === 'keyword') {
      filtered = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerKeyword || r.triggerType === AUTO_MOD.triggerMemberProfile);
    } else if (this.currentFilter === 'spam') {
      filtered = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerSpam);
    } else if (this.currentFilter === 'mention') {
      filtered = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerMentionSpam);
    } else if (this.currentFilter === 'preset') {
      filtered = this.rules.filter(r => r.triggerType === AUTO_MOD.triggerKeywordPreset);
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-title">No AutoMod rules match this filter.</div>
          <div class="empty-hint">Click "Create AutoMod rule" to add one.</div>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(rule => {
      const actionsList = rule.actions || [];
      const hasBlock = actionsList.some(a => a.type === AUTO_MOD.actionBlockMessage);
      const hasAlert = actionsList.some(a => a.type === AUTO_MOD.actionAlert);
      const hasTimeout = actionsList.some(a => a.type === AUTO_MOD.actionTimeout);
      const hasBlockProfile = actionsList.some(a => a.type === AUTO_MOD.actionBlockProfile);

      const actionLabels = [];
      if (hasBlock) actionLabels.push('Block message');
      if (hasAlert) actionLabels.push('Alert');
      if (hasTimeout) actionLabels.push('Timeout');
      if (hasBlockProfile) actionLabels.push('Block update');
      const actionsText = actionLabels.length > 0 ? actionLabels.join(' · ') : 'No actions';

      const exemptCount = `${(rule.exemptRoles || []).length} roles · ${(rule.exemptChannels || []).length} channels`;

      const safeRuleId = escapeHtml(rule.id);
      return `
        <div class="rule-row ${rule.enabled ? 'enabled' : 'disabled'}" id="rule-row-${safeRuleId}">
          <div class="rule-toggle">
            <label class="switch-toggle" title="${rule.enabled ? 'Click to disable' : 'Click to enable'}">
              <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="safetyPage.toggleRuleState('${safeRuleId}', this.checked)" aria-label="Toggle rule">
              <span class="slider"></span>
            </label>
          </div>
          <div class="rule-main">
            <div>
              <div class="rule-name">${this.escapeHtml(rule.name)}</div>
              <div class="rule-trigger">${this.escapeHtml(this.triggerLabel(rule.triggerType))}</div>
            </div>
            <div class="rule-meta">
              <span>${actionsText}</span>
              <span>${exemptCount} exempt</span>
            </div>
          </div>
          <div class="rule-actions">
            <button class="button-icon" title="Edit rule" aria-label="Edit rule" onclick="safetyPage.openEditModal('${safeRuleId}')">
              <i class="fa-solid fa-pen" aria-hidden="true"></i>
            </button>
            <button class="button-icon danger" title="Delete rule" aria-label="Delete rule" onclick="safetyPage.deleteRule('${safeRuleId}')">
              <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async toggleRuleState(ruleId, enabled) {
    const guildId = this.getGuildId();
    try {
      const data = await apiFetch(`/api/guilds/${guildId}/safety/automod/${ruleId}`, {
        method: 'PATCH',
        body: { enabled }
      });

      const idx = this.rules.findIndex(r => r.id === ruleId);
      if (idx !== -1) {
        this.rules[idx] = data.rule;
      }
      this.updateRuleCounts();

      const row = document.getElementById(`rule-row-${ruleId}`);
      if (row) {
        row.classList.toggle('disabled', !enabled);
        row.classList.toggle('enabled', enabled);
      }

      if (window.Mochi) {
        window.Mochi.showToast(enabled ? 'Rule enabled.' : 'Rule disabled.', enabled ? 'success' : 'leave');
      }
    } catch (err) {
      console.error('[Safety] Error toggling rule state:', err);
      if (window.Mochi) {
        window.Mochi.showToast('Could not toggle rule state.', 'leave');
      }
      await this.loadRules(guildId);
    }
  }

  async deleteRule(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    const ruleName = rule ? rule.name : 'this rule';

    if (!confirm(`Delete "${ruleName}" from Discord? This cannot be undone.`)) {
      return;
    }

    const guildId = this.getGuildId();
    try {
      await apiFetch(`/api/guilds/${guildId}/safety/automod/${ruleId}`, { method: 'DELETE' });
      this.rules = this.rules.filter(r => r.id !== ruleId);
      this.updateRuleCounts();
      this.renderRules();

      if (window.Mochi) {
        window.Mochi.showToast('Rule deleted.', 'leave');
      }
    } catch (err) {
      console.error('[Safety] Error deleting rule:', err);
      if (window.Mochi) {
        window.Mochi.showToast('Could not delete rule.', 'leave');
      }
    }
  }

  openCreateModal() {
    document.getElementById('rule-edit-id').value = '';
    document.getElementById('rule-modal-title').textContent = 'Create AutoMod rule';
    document.getElementById('rule-name').value = '';
    document.getElementById('rule-trigger-type').value = String(AUTO_MOD.triggerKeyword);
    this.onTriggerTypeChange(String(AUTO_MOD.triggerKeyword));

    document.getElementById('rule-keywords').value = '';
    document.getElementById('rule-regex').value = '';
    document.getElementById('rule-allowlist').value = '';

    document.getElementById('preset-profanity').checked = true;
    document.getElementById('preset-sexual').checked = true;
    document.getElementById('preset-slurs').checked = true;

    document.getElementById('rule-mention-limit').value = AUTO_MOD.defaultMentionLimit;

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
    document.getElementById('rule-name').focus();
  }

  openEditModal(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return;

    document.getElementById('rule-edit-id').value = rule.id;
    document.getElementById('rule-modal-title').textContent = 'Edit AutoMod rule';
    document.getElementById('rule-name').value = rule.name;
    document.getElementById('rule-trigger-type').value = rule.triggerType;
    this.onTriggerTypeChange(rule.triggerType);

    if (rule.triggerType === AUTO_MOD.triggerKeyword || rule.triggerType === AUTO_MOD.triggerMemberProfile) {
      document.getElementById('rule-keywords').value = (rule.triggerMetadata?.keywordFilter || []).join(', ');
      document.getElementById('rule-regex').value = (rule.triggerMetadata?.regexPatterns || []).join('\n');
      document.getElementById('rule-allowlist').value = (rule.triggerMetadata?.allowList || []).join(', ');
    } else if (rule.triggerType === AUTO_MOD.triggerKeywordPreset) {
      const presets = rule.triggerMetadata?.presets || [];
      document.getElementById('preset-profanity').checked = presets.includes(AUTO_MOD.presetProfanity);
      document.getElementById('preset-sexual').checked = presets.includes(AUTO_MOD.presetSexual);
      document.getElementById('preset-slurs').checked = presets.includes(AUTO_MOD.presetSlurs);
    } else if (rule.triggerType === AUTO_MOD.triggerMentionSpam) {
      document.getElementById('rule-mention-limit').value = rule.triggerMetadata?.mentionTotalLimit || AUTO_MOD.defaultMentionLimit;
    }

    const actions = rule.actions || [];
    const blockAct = actions.find(a => a.type === AUTO_MOD.actionBlockMessage);
    const alertAct = actions.find(a => a.type === AUTO_MOD.actionAlert);
    const timeoutAct = actions.find(a => a.type === AUTO_MOD.actionTimeout);

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
      document.getElementById('rule-timeout-duration').value = timeoutAct.metadata?.durationSeconds || AUTO_MOD.defaultTimeoutSeconds;
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
    document.getElementById('rule-name').focus();
  }

  closeRuleModal() {
    document.getElementById('rule-modal').classList.remove('active');
  }

  onTriggerTypeChange(val) {
    const type = parseInt(val, 10);
    const kwSection = document.getElementById('trigger-config-keyword');
    const presetSection = document.getElementById('trigger-config-preset');
    const mentionSection = document.getElementById('trigger-config-mention');

    if (kwSection) kwSection.style.display = (type === AUTO_MOD.triggerKeyword || type === AUTO_MOD.triggerMemberProfile) ? 'block' : 'none';
    if (presetSection) presetSection.style.display = (type === AUTO_MOD.triggerKeywordPreset) ? 'block' : 'none';
    if (mentionSection) mentionSection.style.display = (type === AUTO_MOD.triggerMentionSpam) ? 'block' : 'none';
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
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }

    try {
      const name = document.getElementById('rule-name').value.trim();
      const triggerType = parseInt(document.getElementById('rule-trigger-type').value, 10);
      const enabled = document.getElementById('rule-enabled').checked;
      const eventType = (triggerType === AUTO_MOD.triggerMemberProfile) ? AUTO_MOD.eventMemberUpdate : AUTO_MOD.eventMessageSend;

      // Trigger Metadata
      const triggerMetadata = {};
      if (triggerType === AUTO_MOD.triggerKeyword || triggerType === AUTO_MOD.triggerMemberProfile) {
        const rawKeywords = document.getElementById('rule-keywords').value;
        triggerMetadata.keywordFilter = rawKeywords.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        const rawRegex = document.getElementById('rule-regex').value;
        triggerMetadata.regexPatterns = rawRegex.split('\n').map(s => s.trim()).filter(Boolean);
        const rawAllow = document.getElementById('rule-allowlist').value;
        triggerMetadata.allowList = rawAllow.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      } else if (triggerType === AUTO_MOD.triggerKeywordPreset) {
        const presets = [];
        if (document.getElementById('preset-profanity').checked) presets.push(AUTO_MOD.presetProfanity);
        if (document.getElementById('preset-sexual').checked) presets.push(AUTO_MOD.presetSexual);
        if (document.getElementById('preset-slurs').checked) presets.push(AUTO_MOD.presetSlurs);
        triggerMetadata.presets = presets;
      } else if (triggerType === AUTO_MOD.triggerMentionSpam) {
        triggerMetadata.mentionTotalLimit = parseInt(document.getElementById('rule-mention-limit').value || AUTO_MOD.defaultMentionLimit, 10);
        triggerMetadata.mentionRaidProtectionEnabled = true;
      }

      // Actions
      const actions = [];
      if (document.getElementById('action-block').checked) {
        const customMessage = document.getElementById('rule-custom-message').value.trim();
        actions.push({
          type: (triggerType === AUTO_MOD.triggerMemberProfile) ? AUTO_MOD.actionBlockProfile : AUTO_MOD.actionBlockMessage,
          metadata: customMessage ? { customMessage } : {}
        });
      }

      if (document.getElementById('action-alert').checked) {
        const channelId = document.getElementById('rule-alert-channel').value;
        if (channelId) {
          actions.push({
            type: AUTO_MOD.actionAlert,
            metadata: { channelId }
          });
        }
      }

      if (document.getElementById('action-timeout').checked) {
        const durationSeconds = parseInt(document.getElementById('rule-timeout-duration').value || AUTO_MOD.defaultTimeoutSeconds, 10);
        actions.push({
          type: AUTO_MOD.actionTimeout,
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

      const data = await apiFetch(url, { method, body: payload });
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
        window.Mochi.showToast(isEdit ? 'Rule updated.' : 'Rule created.', 'success');
      }
    } catch (err) {
      console.error('[Safety] Error saving rule:', err);
      if (window.Mochi) {
        window.Mochi.showToast(`Could not save rule: ${err.message}`, 'leave');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save rule';
      }
    }
  }

  handleAutoModExecution(data) {
    console.log('[Safety] Real-time AutoMod incident received:', data);
    this.incidents.unshift(data);
    if (this.incidents.length > window.MochiConstants.limits.incidentBuffer) this.incidents.pop();
    this.renderIncidentFeed();

    const actionText = (data.action?.type === AUTO_MOD.actionTimeout)
      ? 'Timed out'
      : (data.action?.type === AUTO_MOD.actionAlert ? 'Alerted' : 'Blocked message');
    if (window.Mochi) {
      const parts = [
        { b: 'AutoMod: ' },
        { text: `${data.user?.username || data.userId || 'Unknown'} triggered ${data.ruleName || 'AutoMod rule'} in #${data.channelName || 'chat'}. Action: ` },
        { b: actionText }
      ];
      window.Mochi.showToast(parts, 'leave');
    }
  }

  renderIncidentFeed() {
    const container = document.getElementById('incident-feed-list');
    if (!container) return;

    if (this.incidents.length === 0) {
      container.innerHTML = `
        <div class="empty-state" id="feed-empty-msg">
          <div class="empty-title">No recent AutoMod actions.</div>
          <div class="empty-hint">New AutoMod actions will appear here.</div>
        </div>`;
      return;
    }

    container.innerHTML = this.incidents.map(inc => {
      const timeStr = new Date(inc.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const actionType = inc.action?.type || AUTO_MOD.actionBlockMessage;
      const actionLabels = {
        [AUTO_MOD.actionBlockMessage]: 'Blocked',
        [AUTO_MOD.actionAlert]: 'Alerted',
        [AUTO_MOD.actionTimeout]: 'Timed out',
        [AUTO_MOD.actionBlockProfile]: 'Profile blocked'
      };
      const actionName = actionLabels[actionType] || 'Blocked';

      return `
        <div class="activity-row">
          <div class="activity-row-avatar">
            <img src="${this.escapeHtml(inc.user?.avatar || window.MochiConstants.discord.defaultAvatar)}" alt="">
          </div>
          <div class="activity-row-body">
            <div class="activity-row-head">
              <span class="activity-row-user">${this.escapeHtml(inc.user?.username || 'Unknown user')}</span>
              <span class="channel-name">#${this.escapeHtml(inc.channelName || 'general')}</span>
              <span class="badge badge-warning">${actionName}</span>
              <span class="activity-row-time">${timeStr}</span>
            </div>
            <div class="activity-row-content">"${this.escapeHtml(inc.content || 'Offensive content')}"</div>
            <div class="activity-row-meta">
              ${inc.matchedKeyword ? `<span>Matched: <code>${this.escapeHtml(inc.matchedKeyword)}</code></span>` : ''}
              <span>Rule: ${this.escapeHtml(inc.ruleName || 'AutoMod')}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
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
