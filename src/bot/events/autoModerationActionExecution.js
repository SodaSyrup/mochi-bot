module.exports = {
  name: 'autoModerationActionExecution',
  async execute(action, client) {
    const services = client.services;
    if (!services || !action?.guild) return;

    const payload = {
      guildId: action.guild.id,
      guildName: action.guild.name,
      ruleId: action.ruleId,
      ruleName: null,
      ruleTriggerType: action.ruleTriggerType,
      action: action.action
        ? { type: action.action.type, metadata: action.action.metadata || {} }
        : null,
      userId: action.userId,
      user: action.user
        ? { id: action.user.id, username: action.user.username, avatar: action.user.displayAvatarURL?.() || null }
        : null,
      channelId: action.channelId,
      channelName: action.channel?.name || null,
      messageId: action.messageId,
      content: action.content || '',
      matchedKeyword: action.matchedKeyword || null,
      matchedContent: action.matchedContent || null,
    };

    services.safety.publishExecution(payload);
  }
};
