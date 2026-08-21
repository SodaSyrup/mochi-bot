const { REST, Routes } = require('discord.js');
const config = require('../config');
const catalog = require('../plugins/catalog');
const { ContributionRegistry } = require('../plugins/core/contributionRegistry');
const { PluginManager } = require('../plugins/core/pluginManager');
const { toDeployableCommandData } = require('./commandPolicy');

function collectPluginCommands() {
  const services = {};
  const contributions = new ContributionRegistry({ baseServices: services, serviceTarget: services });
  const manager = new PluginManager({
    plugins: catalog,
    config,
    logger: console,
    baseContext: { client: null, services },
    contributions,
  });
  manager.registerAll();
  return {
    manager,
    commands: contributions.getCommandContributions().map(({ command }) => command),
  };
}

async function deployCommands() {
  const { commands: pluginCommands } = collectPluginCommands();
  if (!config.bot.token || !config.bot.clientId) {
    console.error('[Deploy] Cannot deploy commands: DISCORD_TOKEN and CLIENT_ID are required in .env');
    return;
  }

  const commands = pluginCommands.map(toDeployableCommandData);
  const rest = new REST({ version: '10' }).setToken(config.bot.token);

  try {
    console.log(`[Deploy] Started refreshing ${commands.length} application (/) commands.`);
    const data = await rest.put(Routes.applicationCommands(config.bot.clientId), { body: commands });
    console.log(`[Deploy] Successfully reloaded ${data.length} application (/) commands globally.`);
  } catch (error) {
    console.error('[Deploy] Error deploying commands:', error);
    throw error;
  }
}

if (require.main === module) {
  deployCommands().catch((error) => {
    console.error('[Deploy] Fatal:', error.message);
    process.exitCode = 1;
  });
}

module.exports = deployCommands;
module.exports.collectPluginCommands = collectPluginCommands;
