const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');
const { DEFAULTS } = require('../../../config/defaults');
const { discordInviteUrl } = require('../../../platform/discord/urls');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite-codes')
    .setDescription('List all active invite codes for a specific member or the whole server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Filter invites by user (leave empty for server summary)')
        .setRequired(false)
    ),

  async execute(interaction, client) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!guild.members.me.permissions.has('ManageGuild')) {
      return interaction.reply({
        embeds: [embedBuilder.error('Missing Permissions', 'Mochi requires the `Manage Guild` permission to fetch invite codes.')],
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const invites = await client.services.invites.getActiveInvites(guild.id);
      const targetUser = interaction.options.getUser('user');
      const labelMap = new Map(invites.filter(i => i.label).map(i => [i.code, i.label]));

      let filtered = invites;
      if (targetUser) {
        filtered = filtered.filter(inv => inv.inviter?.id === targetUser.id);
      }

      if (filtered.length === 0) {
        return interaction.editReply({
          embeds: [embedBuilder.info('No Invites Found', targetUser ? `No active invites created by <@${targetUser.id}>.` : 'No active invites found in this server.')]
        });
      }

      let description = '';
      const displayLimit = DEFAULTS.limits.pagination.botInviteCodesDefault;
      filtered.slice(0, displayLimit).forEach(inv => {
        const creator = inv.inviter?.id ? `<@${inv.inviter.id}>` : 'Unknown';
        const max = inv.maxUses > 0 ? `/${inv.maxUses}` : '';
        const customLabel = inv.label;
        const labelText = customLabel ? ` **[🏷️ ${customLabel}]**` : '';
        description += `🔗 **[${discordInviteUrl(inv.code)}](${discordInviteUrl(inv.code)})**${labelText} — \`${inv.uses}${max} uses\` • Created by ${creator}\n`;
      });

      if (filtered.length > displayLimit) {
        description += `\n*...and ${filtered.length - displayLimit} more codes.*`;
      }

      const embed = embedBuilder.base({
        title: `🏷️ Active Server Invites (${filtered.length})`,
        description
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Bot] Error in /invite-codes:', err);
      await interaction.editReply({
        embeds: [embedBuilder.error('Error', 'Failed to fetch invite codes: ' + err.message)]
      });
    }
  }
};
