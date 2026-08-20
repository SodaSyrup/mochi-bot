const { mapDiscordMember } = require('../mappers');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    const services = client.services;
    if (!services) return;

    const memberData = mapDiscordMember(member);
    if (!memberData.guildId) return;

    // Bots never enter the human invite ledger. Route them to the invite-log
    // feature (persisted adder attribution + separate bot message).
    if (memberData.bot) {
      if (services.inviteLogs?.handleBotLeave) {
        await services.inviteLogs.handleBotLeave(memberData);
      }
      return;
    }

    if (!services.policy.shouldTrackMember(memberData)) return;

    await services.invites.trackMemberLeave(memberData);
  }
};
