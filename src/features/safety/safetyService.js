const { AppError, NotFoundError, ExternalServiceError } = require('../../dashboard/errors');
const { SafetyEvents } = require('../../app/eventBus');
const { ValidationError } = require('../../dashboard/errors');
const {
  AUTO_MOD_EVENT_TYPES,
  AUTO_MOD_TRIGGER_TYPES,
  AUTO_MOD_ACTION_TYPES,
  AUTO_MOD_LIMITS,
} = require('../../platform/discord/autoModConstants');

/**
 * Safety feature service. Delegates Discord/AutoMod operations to the safety
 * gateway and publishes canonical automod events. Routes stay thin.
 */
class SafetyService {
  constructor({ safetyGateway, eventBus, logger }) {
    this.gateway = safetyGateway;
    this.eventBus = eventBus;
    this.logger = logger || console;
  }

  async getOverview(guildId) {
    const overview = await this.gateway.getSafetyOverview(guildId);
    if (!overview) throw new NotFoundError('Guild is not available.');
    return overview;
  }

  async updateSettings(guildId, payload) {
    try {
      const safety = await this.gateway.updateSafetySettings(guildId, payload);
      if (!safety) throw new NotFoundError('Guild is not available.');
      return safety;
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error('safety', 'updateSettings', `Failed to update safety settings for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError("Failed to update server safety settings.");
    }
  }

  async listRules(guildId) {
    const rules = await this.gateway.fetchAutoModRules(guildId);
    if (!rules) throw new NotFoundError('Guild is not available.');
    return rules;
  }

  async createRule(guildId, payload) {
    try {
      this.#validateRulePayload(payload);
      const rule = await this.gateway.createAutoModRule(guildId, payload);
      if (!rule) throw new NotFoundError('Guild is not available.');
      // Option A (dedup model): Discord gateway AutoModerationRule* events are
      // the authoritative realtime notification. The service performs the
      // Discord mutation but does NOT publish AutoModRuleUpdated here — the
      // resulting Discord event (external or dashboard-initiated) publishes the
      // one canonical event. This guarantees one logical change yields one
      // dashboard event instead of service + Discord echo duplicates.
      return rule;
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error('safety', 'createRule', `Failed to create AutoMod rule for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError("Failed to create AutoMod rule.");
    }
  }

  async updateRule(guildId, ruleId, updates) {
    try {
      this.#validateRulePayload(updates);
      const rule = await this.gateway.editAutoModRule(guildId, ruleId, updates);
      if (!rule) throw new NotFoundError('AutoMod rule not found.');
      // See createRule — no duplicate publish; the Discord echo publishes once.
      return rule;
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error('safety', 'updateRule', `Failed to edit AutoMod rule ${ruleId} for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError("Failed to edit AutoMod rule.");
    }
  }

  async deleteRule(guildId, ruleId) {
    try {
      await this.gateway.deleteAutoModRule(guildId, ruleId);
      // See createRule — the Discord delete echo publishes once.
      return { ruleId };
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error('safety', 'deleteRule', `Failed to delete AutoMod rule ${ruleId} for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError("Failed to delete AutoMod rule.");
    }
  }

  /**
   * Discord gateway `autoModerationActionExecution` handler: map to a canonical
   * application event. The Discord handler stays a thin adapter.
   */
  publishExecution(actionData) {
    const payload = {
      guildId: actionData.guildId,
      guildName: actionData.guildName || null,
      ruleId: actionData.ruleId || null,
      ruleName: actionData.ruleName || null,
      ruleTriggerType: actionData.ruleTriggerType,
      action: actionData.action || null,
      userId: actionData.userId || null,
      user: actionData.user || null,
      channelId: actionData.channelId || null,
      channelName: actionData.channelName || null,
      messageId: actionData.messageId || null,
      content: actionData.content || '',
      matchedKeyword: actionData.matchedKeyword || null,
      matchedContent: actionData.matchedContent || null,
      executedAt: new Date().toISOString(),
    };
    this.eventBus.emit(SafetyEvents.AutoModExecution, payload);
    return payload;
  }

  publishRuleUpdated({ guildId, action, ruleId, name = null, enabled = null }) {
    const payload = { guildId, action, ruleId, name, enabled };
    this.eventBus.emit(SafetyEvents.AutoModRuleUpdated, payload);
    return payload;
  }

  #validateRulePayload(payload = {}) {
    if (payload.eventType !== undefined) {
      const eventType = Number(payload.eventType);
      if (!AUTO_MOD_EVENT_TYPES.has(eventType)) throw new ValidationError('eventType is not supported by Discord AutoMod.');
    }
    if (payload.triggerType !== undefined) {
      const triggerType = Number(payload.triggerType);
      if (!AUTO_MOD_TRIGGER_TYPES.has(triggerType)) throw new ValidationError('triggerType is not supported by Discord AutoMod.');
    }
    if (payload.actions !== undefined) {
      if (!Array.isArray(payload.actions)) throw new ValidationError('actions must be an array.');
      for (const action of payload.actions) {
        if (!AUTO_MOD_ACTION_TYPES.has(Number(action?.type))) throw new ValidationError('actions contains an unsupported Discord AutoMod action.');
        const duration = action?.metadata?.durationSeconds;
        if (duration !== undefined && (!Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > AUTO_MOD_LIMITS.timeoutMaxSeconds)) {
          throw new ValidationError(`timeout duration must be between 1 and ${AUTO_MOD_LIMITS.timeoutMaxSeconds} seconds.`);
        }
      }
    }
    const mentionLimit = payload.triggerMetadata?.mentionTotalLimit;
    if (mentionLimit !== undefined && (!Number.isInteger(Number(mentionLimit)) || Number(mentionLimit) < AUTO_MOD_LIMITS.mentionTotalMin || Number(mentionLimit) > AUTO_MOD_LIMITS.mentionTotalMax)) {
      throw new ValidationError(`mentionTotalLimit must be between ${AUTO_MOD_LIMITS.mentionTotalMin} and ${AUTO_MOD_LIMITS.mentionTotalMax}.`);
    }
  }
}

module.exports = { SafetyService };
