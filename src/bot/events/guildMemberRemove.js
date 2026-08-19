const inviteTracker = require('../services/inviteTracker');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    const { guild } = member;
    console.log(`[InviteTracker] Member left: ${member.user?.tag || member.id} from ${guild.name}`);

    // Track leave penalty
    const leaveResult = await inviteTracker.trackLeave(member);

    // Notify Dashboard WebSocket in real-time
    if (client.dashboardEmitter) {
      client.dashboardEmitter.emit('memberLeave', {
        guildId: guild.id,
        user: {
          id: member.id,
          username: member.user?.username || 'Unknown',
          avatar: member.user?.displayAvatarURL ? member.user.displayAvatarURL({ dynamic: true }) : null
        },
        inviterId: leaveResult.memberRecord?.inviter_id || null,
        affectedInviter: leaveResult.affectedInviter,
        leftAt: new Date().toISOString()
      });
    }
  }
};
