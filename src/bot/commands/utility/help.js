const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View Mochi invite tracking commands & dashboard link'),

  async execute(interaction) {
    const embed = embedBuilder.base({
      title: '🍡 Mochi • Invite Tracker & Dashboard',
      description: `Mochi tracks all server invites, computes net scores, identifies fake accounts, and feeds live analytics to your Web Dashboard.\n\n🌐 **Web Dashboard:** [${config.dashboard.url}](${config.dashboard.url})`,
      fields: [
        {
          name: '📊 Commands',
          value: [
            '`/invites [user]` — View detailed personal or target member invite counts',
            '`/leaderboard [page]` — Top inviters leaderboard in this server',
            '`/invite-codes [user]` — List active server invite links & uses',
            '`/honeypot <channel>` — Protect a channel from spam bots',
            '`/botinfo` — Bot telemetry and system uptime',
            '`/ping` — Check latency and gateway status'
          ].join('\n')
        }
      ]
    });

    await interaction.reply({ embeds: [embed] });
  }
};
