const { mapDiscordMember } = require('../mappers');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    const services = client.services;
    if (!services) return;

    const memberData = mapDiscordMember(member);
    if (!memberData.guildId) return;

    // Same policy used by historical sync and the simulator.
    if (!services.policy.shouldTrackMember(memberData)) return;

    await services.invites.trackMemberJoin(memberData);
  }
};
