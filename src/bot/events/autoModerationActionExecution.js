module.exports = {
  name: 'autoModerationActionExecution',
  async execute(autoModAction, client) {
    if (!autoModAction || !autoModAction.guild) return;

    const actionData = {
      guildId: autoModAction.guild.id,
      guildName: autoModAction.guild.name,
      ruleId: autoModAction.ruleId,
      ruleTriggerType: autoModAction.ruleTriggerType,
      action: autoModAction.action ? {
        type: autoModAction.action.type,
        metadata: autoModAction.action.metadata || {}
      } : null,
      userId: autoModAction.userId,
      user: autoModAction.user ? {
        id: autoModAction.user.id,
        username: autoModAction.user.username,
        avatar: autoModAction.user.displayAvatarURL?.()
      } : null,
      channelId: autoModAction.channelId,
      channelName: autoModAction.channel?.name || null,
      messageId: autoModAction.messageId,
      alertMessageId: autoModAction.alertMessageId,
      content: autoModAction.content || '',
      matchedKeyword: autoModAction.matchedKeyword || null,
      matchedContent: autoModAction.matchedContent || null,
      executedAt: new Date().toISOString()
    };

    console.log(`[AutoMod] Action executed in ${autoModAction.guild.name}: Rule ID ${autoModAction.ruleId} by User ${autoModAction.userId}`);

    // Emit to dashboard WebSocket clients
    if (client.dashboardEmitter) {
      client.dashboardEmitter.emit('autoModExecution', actionData);
    }
  }
};
