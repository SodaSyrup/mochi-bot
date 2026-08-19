module.exports = {
  name: 'autoModerationRuleDelete',
  async execute(rule, client) {
    if (!rule || !rule.guild) return;
    console.log(`[AutoMod] Rule deleted in ${rule.guild.name}: ${rule.name} (ID: ${rule.id})`);
    if (client.dashboardEmitter) {
      client.dashboardEmitter.emit('autoModRuleUpdated', {
        guildId: rule.guild.id,
        action: 'delete',
        ruleId: rule.id,
        name: rule.name
      });
    }
  }
};
