const { ApplicationIntegrationType, InteractionContextType } = require('discord.js');

function toDeployableCommandData(command: any): any {
  const data = command.data.toJSON();
  if (data.integration_types === undefined) data.integration_types = [ApplicationIntegrationType.GuildInstall];
  if (data.contexts === undefined) data.contexts = [InteractionContextType.Guild];
  return data;
}

module.exports = { toDeployableCommandData };

