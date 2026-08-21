const { REST, Routes } = require('discord.js');
const config = require('../config');
const { getFiles } = require('./handler');
const { toDeployableCommandData } = require('./commandPolicy');
const path = require('path');

async function deployCommands() {
  if (!config.bot.token || !config.bot.clientId) {
    console.error('[Deploy] Cannot deploy commands: DISCORD_TOKEN and CLIENT_ID are required in .env');
    return;
  }

  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = getFiles(commandsPath);

  for (const filePath of commandFiles) {
    const command = require(filePath);
    if (command.data && typeof command.data.toJSON === 'function') {
      commands.push(toDeployableCommandData(command));
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.bot.token);

  try {
    console.log(`[Deploy] Started refreshing ${commands.length} application (/) commands.`);
    const data = await rest.put(
      Routes.applicationCommands(config.bot.clientId),
      { body: commands }
    );
    console.log(`[Deploy] Successfully reloaded ${data.length} application (/) commands globally.`);
  } catch (error) {
    console.error('[Deploy] Error deploying commands:', error);
  }
}

if (require.main === module) {
  deployCommands();
}

module.exports = deployCommands;
