const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');
const { discordInviteUrl } = require('../../../platform/discord/urls');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite-label')
    .setDescription('Add, edit, or remove a campaign label for a Discord invite link')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName('code')
        .setDescription('The invite code (e.g. mochi-vibes or full link discord.gg/...)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('label')
        .setDescription('The custom label to attach (leave empty to remove label)')
        .setRequired(false)
    ),

  async execute(interaction, client) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    let rawCode = interaction.options.getString('code').trim();
    if (rawCode.includes('discord.gg/')) {
      rawCode = rawCode.split('discord.gg/')[1].split('/')[0].split('?')[0];
    } else if (rawCode.includes('discord.com/invite/')) {
      rawCode = rawCode.split('discord.com/invite/')[1].split('/')[0].split('?')[0];
    }

    const label = interaction.options.getString('label');

    if (!label || !label.trim()) {
      client.services.invites.removeInviteLabel(guild.id, rawCode);
      return interaction.reply({
        embeds: [embedBuilder.success('Label Removed', `Removed custom label from invite code \`${rawCode}\`.`)],
        ephemeral: true
      });
    }

    client.services.invites.setInviteLabel({
      guildId: guild.id,
      code: rawCode,
      label: label.trim(),
    });

    const embed = embedBuilder.success(
      '🏷️ Invite Labeled Successfully',
      `Invite **[${discordInviteUrl(rawCode)}](${discordInviteUrl(rawCode)})** has been labeled as:\n**🏷️ ${label.trim()}**\n\nThis label will be visible on the Mochi Web Dashboard and in invite leaderboards.`
    );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
