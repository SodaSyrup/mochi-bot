const inviteTracker = require('../services/inviteTracker');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    // Skip if it's the bot itself joining
    if (member.user.bot && member.id === client.user.id) return;

    const { guild } = member;
    console.log(`[InviteTracker] Member joined: ${member.user.tag} in ${guild.name}`);

    // Track invite delta and save to database
    const joinResult = await inviteTracker.trackJoin(member);

    // Notify Dashboard WebSocket in real-time
    if (client.dashboardEmitter) {
      client.dashboardEmitter.emit('memberJoin', {
        guildId: guild.id,
        user: {
          id: member.id,
          username: member.user.username,
          avatar: member.user.displayAvatarURL({ dynamic: true })
        },
        inviter: joinResult.inviterUser ? {
          id: joinResult.inviterUser.id,
          username: joinResult.inviterUser.username
        } : null,
        code: joinResult.usedInvite?.code || (joinResult.joinType === 'VANITY' ? 'VANITY' : 'N/A'),
        isFake: joinResult.isFake,
        inviterStats: joinResult.inviterStats,
        joinedAt: new Date().toISOString()
      });
    }
  }
};
