const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Display detailed information and invite records for a user')
    .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(false)),

  async execute(interaction, client) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
    const guildId = interaction.guildId;

    const stats = guildId ? client.services.invites.getInviterStats(guildId, targetUser.id) : null;
    const memberRecord = guildId ? client.services.invites.getCurrentMember(guildId, targetUser.id) : null;

    let inviterText = 'None / Direct';
    if (memberRecord?.attribution_type) {
      if (memberRecord.attribution_type === 'INVITE' && memberRecord.inviter_id) {
        inviterText = `<@${memberRecord.inviter_id}>`;
      } else if (memberRecord.attribution_type === 'VANITY') {
        inviterText = 'Vanity URL';
      } else if (memberRecord.attribution_type === 'UNKNOWN') {
        inviterText = 'Direct / Unknown';
      } else if (memberRecord.attribution_type === 'PRE_EXISTING') {
        inviterText = 'Pre-Bot (Unknown)';
      }
    }

    const embed = embedBuilder.base({
      title: `👤 ${targetUser.tag}`,
      thumbnail: targetUser.displayAvatarURL({ dynamic: true }),
      fields: [
        { name: '🆔 User ID', value: `\`${targetUser.id}\``, inline: true },
        { name: '🤖 Is Bot', value: targetUser.bot ? '`Yes`' : '`No`', inline: true },
        { name: '🎂 Account Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '📥 Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '`Not in server`', inline: true },
        { name: '🎯 Invited By', value: inviterText, inline: true },
        { name: '🏷️ Invite Code', value: memberRecord?.invite_code ? `\`${memberRecord.invite_code}\`` : '`None`', inline: true },
        {
          name: '📊 Invites Created By User',
          value: stats ? `**${stats.total}** Net \`(${stats.regular} regular, ${stats.bonus} bonus, ${stats.leaves} leaves, ${stats.fake} fake)\`` : '`0`',
          inline: false
        }
      ]
    });

    await interaction.reply({ embeds: [embed] });
  }
};
