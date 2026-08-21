const { EmbedBuilder } = require('discord.js');

function buildHoneypotEmbed(kicks = 0) {
  return new EmbedBuilder()
    .setColor('#e9a45e')
    .setTitle('🍯 DO NOT SEND MESSAGES IN THIS CHANNEL')
    .setDescription('This channel is used to catch spam bots. Any messages sent here will result in a **softban**.')
    .addFields({ name: '🍯 Kicks', value: String(kicks), inline: true })
    .setFooter({ text: 'Honeypot protection • Do not interact with this channel' });
}

module.exports = { buildHoneypotEmbed };
