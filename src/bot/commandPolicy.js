const { ApplicationIntegrationType, InteractionContextType } = require('discord.js');

/**
 * Add the Discord application metadata needed for Mochi's native integration
 * permissions UI. Mochi is a server bot: its commands should be installed in
 * guilds and run in guild channels, where Server Settings > Integrations can
 * manage access by role, member, or channel.
 *
 * Keep command-specific defaults on the command builders themselves. Those
 * defaults are part of Discord's command definition and remain visible to
 * administrators as the starting point for native permission overrides.
 */
function toDeployableCommandData(command) {
  const data = command.data.toJSON();

  if (data.integration_types === undefined) {
    data.integration_types = [ApplicationIntegrationType.GuildInstall];
  }
  if (data.contexts === undefined) {
    data.contexts = [InteractionContextType.Guild];
  }

  return data;
}

module.exports = { toDeployableCommandData };
