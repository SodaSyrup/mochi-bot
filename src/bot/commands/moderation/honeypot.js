const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('honeypot')
    .setDescription('Assign a channel that softbans anyone who sends a message there')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option => option
      .setName('channel')
      .setDescription('The text channel to use as the honeypot')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)),

  async execute(interaction, client) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel', true);
    if (channel.guildId !== interaction.guild.id || !channel.isTextBased?.()) {
      return interaction.reply({ content: 'Please choose a text channel in this server.', ephemeral: true });
    }

    try {
      const config = await client.services.honeypot.configure({
        guildId: interaction.guild.id,
        channelId: channel.id,
      });

      return interaction.reply({
        embeds: [embedBuilder.success(
          'Honeypot Enabled',
          `Messages in <#${config.channel_id}> will trigger a softban.\n\nThe honeypot banner is now tracking **${config.kicks}** kicks.`
        )],
        ephemeral: true,
      });
    } catch (error) {
      return interaction.reply({
        embeds: [embedBuilder.error('Honeypot Setup Failed', error.message || 'Check the bot permissions for that channel.')],
        ephemeral: true,
      });
    }
  },
};
