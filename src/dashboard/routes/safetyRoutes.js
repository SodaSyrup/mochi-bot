const express = require('express');
const { ValidationError } = require('../errors');
const { AutoModerationRuleEventType, AutoModerationRuleTriggerType } = require('../../platform/discord/autoModConstants');

/**
 * Safety/AutoMod routes — thin adapters over SafetyService.
 */
function createSafetyRoutes({ safetyService }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const safety = await safetyService.getOverview(req.params.guildId);
    res.json({ safety });
  });

  router.patch('/settings', async (req, res) => {
    const {
      verificationLevel,
      explicitContentFilter,
      defaultMessageNotifications,
      safetyAlertsChannelId,
    } = req.body || {};
    const safety = await safetyService.updateSettings(req.params.guildId, {
      verificationLevel,
      explicitContentFilter,
      defaultMessageNotifications,
      safetyAlertsChannelId,
    });
    res.json({ success: true, message: 'Server safety settings updated', safety });
  });

  router.get('/automod', async (req, res) => {
    const rules = await safetyService.listRules(req.params.guildId);
    res.json({ rules });
  });

  router.post('/automod', async (req, res) => {
    const {
      name,
      eventType = AutoModerationRuleEventType.MessageSend,
      triggerType = AutoModerationRuleTriggerType.Keyword,
      triggerMetadata = {},
      actions = [],
      exemptRoles = [],
      exemptChannels = [],
      enabled = true,
    } = req.body || {};

    if (!name || !name.trim()) {
      throw new ValidationError('Rule name is required.');
    }

    const rule = await safetyService.createRule(req.params.guildId, {
      name,
      eventType,
      triggerType,
      triggerMetadata,
      actions,
      exemptRoles,
      exemptChannels,
      enabled,
    });
    res.status(201).json({ success: true, message: 'AutoMod rule created successfully', rule });
  });

  router.patch('/automod/:ruleId', async (req, res) => {
    const rule = await safetyService.updateRule(req.params.guildId, req.params.ruleId, req.body || {});
    res.json({ success: true, message: 'AutoMod rule updated successfully', rule });
  });

  router.delete('/automod/:ruleId', async (req, res) => {
    const result = await safetyService.deleteRule(req.params.guildId, req.params.ruleId);
    res.json({ success: true, message: 'AutoMod rule deleted successfully', ruleId: result.ruleId });
  });

  return router;
}

module.exports = { createSafetyRoutes };
