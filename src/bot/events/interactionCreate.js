const embedBuilder = require('../services/embedBuilder');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[Bot] Command not found: ${interaction.commandName}`);
      return;
    }

    const contribution = client.pluginContributions?.getCommandContribution?.(interaction.commandName);
    if (contribution && interaction.guildId && client.services?.pluginSettings) {
      const enabled = client.services.pluginSettings.isEnabled(interaction.guildId, contribution.pluginId);
      if (!enabled) {
        await interaction.reply({ content: 'This feature is disabled for this server.', ephemeral: true }).catch(() => {});
        return;
      }
    }

    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`[Bot] Error executing /${interaction.commandName}:`, error);
      const errorEmbed = embedBuilder.error(
        'Command Execution Error',
        'There was an error while executing this command! Please try again later.'
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
      }
    }
  }
};
