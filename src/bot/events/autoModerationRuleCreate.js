module.exports = {
  name: 'autoModerationRuleCreate',
  async execute(rule, client) {
    const services = client.services;
    if (!services || !rule?.guild) return;
    services.safety.publishRuleUpdated({
      guildId: rule.guild.id,
      action: 'create',
      ruleId: rule.id,
      name: rule.name,
    });
  }
};
