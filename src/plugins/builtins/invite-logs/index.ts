const { mapDiscordMember } = require('../../../bot/mappers');

function botMemberHandler(name: string, operation: string) {
  return { name, async execute(member: any, client: any) {
    const memberData = mapDiscordMember(member);
    if (!memberData.guildId || !memberData.bot) return;
    await client.services?.inviteLogs?.[operation]?.(memberData);
  } };
}

module.exports = {
  manifest: { id: 'invite-logs', name: 'Invite Logs', version: '1.0.0', apiVersion: 1, description: 'Logs human invite activity and bot additions/removals.', requires: ['invites'] },
  migrations: [],
  register(context: any) {
    const services = context.baseServices;
    context.services.register('inviteLogs', services.inviteLogs);
    context.services.register('inviteLogRepository', services.inviteLogRepository);
    context.services.register('inviteLogGateway', services.inviteLogGateway);
    context.discordEvents.register(botMemberHandler('guildMemberAdd', 'handleBotJoin'), { source: 'src/bot/events/guildMemberAdd.js' });
    context.discordEvents.register(botMemberHandler('guildMemberRemove', 'handleBotLeave'), { source: 'src/bot/events/guildMemberRemove.js' });
  },
  async stop(context: any) { context.baseServices.inviteLogs?.detachSubscriptions?.(); },
};

