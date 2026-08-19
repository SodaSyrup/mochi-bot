const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');
const os = require('os');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Display detailed bot statistics, system resources, and version info'),

  async execute(interaction, client) {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const memUsage = process.memoryUsage();
    const ramUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
    const ramTotalMB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);

    const totalServers = client.guilds.cache.size;
    const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

    const embed = embedBuilder.base({
      title: '🍡 About Mochi',
      description: 'Mochi is a modular, high-performance all-purpose Discord bot featuring real-time invite tracking and an interactive web dashboard.',
      thumbnail: client.user.displayAvatarURL(),
      fields: [
        { name: '⏱️ Uptime', value: `\`${days}d ${hours}h ${minutes}m ${seconds}s\``, inline: true },
        { name: '💾 Memory (RAM)', value: `\`${ramUsedMB} MB / ${ramTotalMB} GB\``, inline: true },
        { name: '⚡ Node.js', value: `\`${process.version}\``, inline: true },
        { name: '🏰 Servers', value: `\`${totalServers}\``, inline: true },
        { name: '👥 Total Members', value: `\`${totalMembers}\``, inline: true },
        { name: '🏓 Gateway Latency', value: `\`${client.ws.ping}ms\``, inline: true },
        { name: '🌐 Web Dashboard', value: `[Access Dashboard](${config.dashboard.url})`, inline: true }
      ]
    });

    await interaction.reply({ embeds: [embed] });
  }
};
