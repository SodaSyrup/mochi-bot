const { mapDiscordMember } = require('../mappers');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    const services = client.services;
    if (!services) return;

    const memberData = mapDiscordMember(member);
    if (!memberData.guildId) return;

    // Bots never enter the human invite ledger. Route them to the invite-log
    // feature (audit-log attribution + separate bot message) and stop here.
    if (memberData.bot) {
      if (services.inviteLogs?.handleBotJoin) {
        await services.inviteLogs.handleBotJoin(memberData);
      }
      return;
    }

    // Apply the same policy used by member reconciliation.
    if (!services.policy.shouldTrackMember(memberData)) return;

    await services.invites.trackMemberJoin(memberData);
  }
};
