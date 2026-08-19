module.exports = {
  name: 'autoModerationRuleUpdate',
  async execute(oldRule, newRule, client) {
    const rule = newRule || oldRule;
    if (!rule || !rule.guild) return;
    console.log(`[AutoMod] Rule updated in ${rule.guild.name}: ${rule.name} (ID: ${rule.id})`);
    if (client.dashboardEmitter) {
      client.dashboardEmitter.emit('autoModRuleUpdated', {
        guildId: rule.guild.id,
        action: 'update',
        ruleId: rule.id,
        name: rule.name,
        enabled: rule.enabled
      });
    }
  }
};
