const { SlashCommandBuilder } = require('discord.js');
const embedBuilder = require('../../services/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Display detailed statistics and information about this server'),

  async execute(interaction, client) {
    const { guild } = interaction;
    if (!guild) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const owner = await guild.fetchOwner().catch(() => null);
    const channels = guild.channels.cache;
    const textChannels = channels.filter(c => c.isTextBased()).size;
    const voiceChannels = channels.filter(c => c.isVoiceBased()).size;
    const rolesCount = guild.roles.cache.size;
    const invitersCount = client.services.invites.getInvitersCount(guild.id);

    const embed = embedBuilder.base({
      title: `🏰 ${guild.name}`,
      thumbnail: guild.iconURL({ dynamic: true }),
      fields: [
        { name: '👑 Owner', value: owner ? `<@${owner.id}>` : 'Unknown', inline: true },
        { name: '👥 Members', value: `\`${guild.memberCount}\``, inline: true },
        { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '💬 Text Channels', value: `\`${textChannels}\``, inline: true },
        { name: '🔊 Voice Channels', value: `\`${voiceChannels}\``, inline: true },
        { name: '🎭 Roles', value: `\`${rolesCount}\``, inline: true },
        { name: '🎯 Tracked Inviters', value: `\`${invitersCount}\``, inline: true },
        { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
        { name: '🚀 Boost Level', value: `Tier ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true }
      ]
    });

    await interaction.reply({ embeds: [embed] });
  }
};
