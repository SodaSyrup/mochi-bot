const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check Mochi’s response latency and WebSocket ping'),

  async execute(interaction, client) {
    const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = client.ws.ping;

    const embed = embedBuilder.base({
      title: '🏓 Pong!',
      fields: [
        { name: '⚡ Roundtrip Latency', value: `\`${roundtrip}ms\``, inline: true },
        { name: '🌐 WebSocket Heartbeat', value: `\`${wsPing}ms\``, inline: true }
      ]
    });

    await interaction.editReply({ content: null, embeds: [embed] });
  }
};
