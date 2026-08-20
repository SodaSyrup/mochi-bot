const { NotFoundError, ExternalServiceError } = require('../../dashboard/errors');
const { InviteEvents } = require('../../app/eventBus');

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
      if (err.name === 'AppError') throw err;
      this.logger.error('safety', 'updateSettings', `Failed to update safety settings for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError(`Failed to update server safety settings: ${err.message}`);
    }
  }

  async listRules(guildId) {
    const rules = await this.gateway.fetchAutoModRules(guildId);
    if (!rules) throw new NotFoundError('Guild is not available.');
    return rules;
  }

  async createRule(guildId, payload) {
    try {
      const rule = await this.gateway.createAutoModRule(guildId, payload);
      if (!rule) throw new NotFoundError('Guild is not available.');
      this.eventBus.emit(InviteEvents.AutoModRuleUpdated, { guildId, action: 'create', rule });
      return rule;
    } catch (err) {
      if (err.name === 'AppError') throw err;
      this.logger.error('safety', 'createRule', `Failed to create AutoMod rule for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError(`Failed to create AutoMod rule: ${err.message}`);
    }
  }

  async updateRule(guildId, ruleId, updates) {
    try {
      const rule = await this.gateway.editAutoModRule(guildId, ruleId, updates);
      if (!rule) throw new NotFoundError('AutoMod rule not found.');
      this.eventBus.emit(InviteEvents.AutoModRuleUpdated, { guildId, action: 'update', rule });
      return rule;
    } catch (err) {
      if (err.name === 'AppError') throw err;
      this.logger.error('safety', 'updateRule', `Failed to edit AutoMod rule ${ruleId} for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError(`Failed to edit AutoMod rule: ${err.message}`);
    }
  }

  async deleteRule(guildId, ruleId) {
    try {
      await this.gateway.deleteAutoModRule(guildId, ruleId);
      this.eventBus.emit(InviteEvents.AutoModRuleUpdated, { guildId, action: 'delete', ruleId });
      return { ruleId };
    } catch (err) {
      if (err.name === 'AppError') throw err;
      this.logger.error('safety', 'deleteRule', `Failed to delete AutoMod rule ${ruleId} for guild ${guildId}`, { guildId, error: err });
      throw new ExternalServiceError(`Failed to delete AutoMod rule: ${err.message}`);
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
    this.eventBus.emit(InviteEvents.AutoModExecution, payload);
    return payload;
  }

  publishRuleUpdated({ guildId, action, ruleId, name = null, enabled = null }) {
    const payload = { guildId, action, ruleId, name, enabled };
    this.eventBus.emit(InviteEvents.AutoModRuleUpdated, payload);
    return payload;
  }

  /**
   * Simulator input only: produce a canonical AutoMod execution event without
   * any live Discord interaction.
   */
  async simulateExecution(guildId, input) {
    const payload = {
      guildId,
      guildName: input.guildName || null,
      ruleId: input.ruleId || null,
      ruleName: input.ruleName || null,
      ruleTriggerType: parseInt(input.triggerType, 10),
      action: {
        type: parseInt(input.actionType, 10),
        metadata: {
          channelId: input.channelId || null,
          durationSeconds: input.timeoutSeconds || 0,
          customMessage: input.customMessage || 'Message blocked by Discord AutoMod protection.',
        },
      },
      userId: input.userId || null,
      user: input.user || null,
      channelId: input.channelId || null,
      channelName: input.channelName || null,
      messageId: input.messageId || null,
      content: input.content || '',
      matchedKeyword: input.matchedKeyword || null,
      matchedContent: input.matchedKeyword || null,
      executedAt: new Date().toISOString(),
    };
    this.eventBus.emit(InviteEvents.AutoModExecution, payload);
    return payload;
  }
}

module.exports = { SafetyService };
