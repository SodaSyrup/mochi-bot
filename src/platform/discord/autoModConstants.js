const {
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
} = require('discord.js');

const AUTO_MOD_EVENT_TYPES = Object.freeze(new Set(Object.values(AutoModerationRuleEventType).filter(Number.isInteger)));
const AUTO_MOD_TRIGGER_TYPES = Object.freeze(new Set(Object.values(AutoModerationRuleTriggerType).filter(Number.isInteger)));
const AUTO_MOD_ACTION_TYPES = Object.freeze(new Set(Object.values(AutoModerationActionType).filter(Number.isInteger)));

const AUTO_MOD_LIMITS = Object.freeze({
  mentionTotalMin: 1,
  mentionTotalMax: 50,
  mentionTotalDefault: 5,
  timeoutMaxSeconds: 28 * 24 * 60 * 60,
});

function assertAutoModInteger(value, allowed, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !allowed.has(parsed)) {
    throw new Error(`${name} is not a supported Discord AutoMod value.`);
  }
  return parsed;
}

module.exports = {
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
  AUTO_MOD_EVENT_TYPES,
  AUTO_MOD_TRIGGER_TYPES,
  AUTO_MOD_ACTION_TYPES,
  AUTO_MOD_LIMITS,
  assertAutoModInteger,
};
