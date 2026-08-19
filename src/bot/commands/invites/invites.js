const { SlashCommandBuilder } = require('discord.js');
const inviteRepo = require('../../../database/repositories/inviteRepo');
const embedBuilder = require('../../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Check your own or another member’s invite count & statistics')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The member whose invites you want to view (defaults to you)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    if (!guildId) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const stats = inviteRepo.getInviter(guildId, targetUser.id);
    const embed = embedBuilder.invites(targetUser, stats, interaction.guild.name);

    await interaction.reply({ embeds: [embed] });
  }
};
