module.exports = {
  name: 'autoModerationRuleCreate',
  async execute(rule, client) {
    if (!rule || !rule.guild) return;
    console.log(`[AutoMod] Rule created in ${rule.guild.name}: ${rule.name} (ID: ${rule.id})`);
    if (client.dashboardEmitter) {
      client.dashboardEmitter.emit('autoModRuleUpdated', {
        guildId: rule.guild.id,
        action: 'create',
        ruleId: rule.id,
        name: rule.name
      });
    }
  }
};
