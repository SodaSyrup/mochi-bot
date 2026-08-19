const { SlashCommandBuilder } = require('discord.js');
const inviteRepo = require('../../../database/repositories/inviteRepo');
const embedBuilder = require('../../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top inviters in this server')
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number')
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction, client) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const page = interaction.options.getInteger('page') || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const totalInviters = inviteRepo.getInvitersCount(guild.id);
    const totalPages = Math.max(1, Math.ceil(totalInviters / limit));

    if (page > totalPages && totalInviters > 0) {
      return interaction.reply({
        embeds: [embedBuilder.warn('Page Not Found', `There are only ${totalPages} pages on the leaderboard.`)],
        ephemeral: true
      });
    }

    const rows = inviteRepo.getLeaderboard(guild.id, limit, offset);

    if (rows.length === 0) {
      return interaction.reply({
        embeds: [embedBuilder.info('Leaderboard Empty', 'No invites have been tracked in this server yet!')]
      });
    }

    const medals = ['🥇', '🥈', '🥉'];
    let description = `**Top Inviters in ${guild.name}**\n\n`;

    rows.forEach((row, idx) => {
      const rank = offset + idx + 1;
      const rankBadge = rank <= 3 ? medals[rank - 1] : `**#${rank}**`;
      const net = row.total;
      description += `${rankBadge} <@${row.user_id}> — **${net}** net \`(${row.regular} reg, ${row.leaves} leaves, ${row.fake} fake)\`\n`;
    });

    const embed = embedBuilder.base({
      title: `🏆 Invite Leaderboard`,
      description,
      footer: { text: `Page ${page} of ${totalPages} • Total Tracked Inviters: ${totalInviters}` }
    });

    await interaction.reply({ embeds: [embed] });
  }
};
