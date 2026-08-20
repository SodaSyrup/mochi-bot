module.exports = {
  name: 'autoModerationRuleUpdate',
  async execute(oldRule, newRule, client) {
    const services = client.services;
    const rule = newRule || oldRule;
    if (!services || !rule?.guild) return;
    services.safety.publishRuleUpdated({
      guildId: rule.guild.id,
      action: 'update',
      ruleId: rule.id,
      name: rule.name,
      enabled: rule.enabled,
    });
  }
};
