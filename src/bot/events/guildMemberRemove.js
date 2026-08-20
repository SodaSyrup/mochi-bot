const { mapDiscordMember } = require('../mappers');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    const services = client.services;
    if (!services) return;

    const memberData = mapDiscordMember(member);
    if (!memberData.guildId) return;
    if (!services.policy.shouldTrackMember(memberData)) return;

    await services.invites.trackMemberLeave(memberData);
  }
};
