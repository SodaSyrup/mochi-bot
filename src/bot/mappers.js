/**
 * Translate Discord.js objects into plain application DTOs. Discord primitives
 * never cross into application services.
 */
function mapDiscordMember(member) {
  return {
    id: member.id,
    guildId: member.guild?.id,
    username: member.user?.username || null,
    avatar: member.user?.displayAvatarURL?.({ dynamic: true }) || null,
    bot: Boolean(member.user?.bot),
    joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
    accountCreatedAt: member.user?.createdAt ? member.user.createdAt.toISOString() : null,
  };
}

function mapDiscordInvite(invite) {
  return {
    guildId: invite.guild?.id || null,
    code: invite.code,
    uses: invite.uses || 0,
    maxUses: invite.maxUses || 0,
    inviterId: invite.inviter?.id || null,
    channelId: invite.channel?.id || null,
    channelName: invite.channel?.name || null,
    createdAt: invite.createdAt ? invite.createdAt.toISOString() : null,
  };
}

module.exports = { mapDiscordMember, mapDiscordInvite };
