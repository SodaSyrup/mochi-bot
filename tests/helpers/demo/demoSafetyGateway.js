const { DEMO_GUILD_ID, DEMO_AUTOMOD_RULES, DEMO_GUILD } = require('./fixtures');
const { SafetyEvents } = require('../../../src/app/eventBus');

/**
 * Demo safety gateway — in-memory AutoMod/safety mirror for APP_MODE=demo.
 *
 * In live mode the Discord gateway's AutoModerationRule* events are the single
 * source of realtime rule notifications (SafetyService deliberately does NOT
 * publish after a mutation). In demo mode there is no Discord echo, so this
 * gateway mirrors the authoritative-event model by publishing one canonical
 * AutoModRuleUpdated payload after every mutation. The payload shape is
 * identical to the live Discord-event path.
 */
class DemoSafetyGateway {
  constructor({ eventBus = null } = {}) {
    this.eventBus = eventBus;
    this.rules = new Map();
    this.safetySettings = {
      guildId: DEMO_GUILD_ID,
      guildName: DEMO_GUILD.name,
      verificationLevel: 1,
      explicitContentFilter: 1,
      defaultMessageNotifications: 1,
      mfaLevel: 0,
      safetyAlertsChannelId: 'chan_announcements',
      rulesChannelId: 'chan_welcome',
      features: [...DEMO_GUILD.features],
      isSimulated: true,
    };
    for (const rule of DEMO_AUTOMOD_RULES) {
      this.rules.set(rule.id, JSON.parse(JSON.stringify({ ...rule, guildId: DEMO_GUILD_ID })));
    }
  }

  #publish(action, rule) {
    if (!this.eventBus || !rule) return;
    this.eventBus.emit(SafetyEvents.AutoModRuleUpdated, {
      guildId: rule.guildId || DEMO_GUILD_ID,
      action,
      ruleId: rule.id,
      name: rule.name,
      enabled: Boolean(rule.enabled),
    });
  }

  async getSafetyOverview(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    const allRules = Array.from(this.rules.values());
    return {
      ...this.safetySettings,
      guildId,
      rulesCount: allRules.length,
      enabledRulesCount: allRules.filter((r) => r.enabled).length,
      isSimulated: true,
    };
  }

  async updateSafetySettings(guildId, payload) {
    if (guildId !== DEMO_GUILD_ID) return null;
    const next = { ...this.safetySettings };
    for (const key of ['verificationLevel', 'explicitContentFilter', 'defaultMessageNotifications']) {
      if (payload[key] !== undefined) next[key] = payload[key];
    }
    if (payload.safetyAlertsChannelId !== undefined) next.safetyAlertsChannelId = payload.safetyAlertsChannelId || null;
    this.safetySettings = next;
    return { ...next, isSimulated: true };
  }

  async fetchAutoModRules(guildId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    return Array.from(this.rules.values());
  }

  async createAutoModRule(guildId, payload) {
    if (guildId !== DEMO_GUILD_ID) return null;
    const id = `automod_rule_${Date.now()}`;
    const rule = {
      id,
      guildId,
      name: payload.name,
      enabled: Boolean(payload.enabled),
      eventType: payload.eventType,
      triggerType: payload.triggerType,
      triggerMetadata: payload.triggerMetadata || {},
      actions: payload.actions && payload.actions.length ? payload.actions : [{ type: 1, metadata: {} }],
      exemptRoles: payload.exemptRoles || [],
      exemptChannels: payload.exemptChannels || [],
      creatorId: payload.creatorId || null,
    };
    this.rules.set(id, rule);
    this.#publish('create', rule);
    return rule;
  }

  async editAutoModRule(guildId, ruleId, updates) {
    if (guildId !== DEMO_GUILD_ID) return null;
    const rule = this.rules.get(ruleId);
    if (!rule) return null;
    const next = { ...rule, ...updates };
    this.rules.set(ruleId, next);
    this.#publish('update', next);
    return next;
  }

  async deleteAutoModRule(guildId, ruleId) {
    if (guildId !== DEMO_GUILD_ID) return null;
    const rule = this.rules.get(ruleId);
    this.rules.delete(ruleId);
    this.#publish('delete', rule || { id: ruleId, guildId, name: null, enabled: false });
    return { ruleId };
  }
}

module.exports = { DemoSafetyGateway };

