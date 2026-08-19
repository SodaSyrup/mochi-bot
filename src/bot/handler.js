const fs = require('fs');
const path = require('path');

/**
 * Recursively find all .js files in a directory
 */
function getFiles(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      files = files.concat(getFiles(path.join(dir, item.name)));
    } else if (item.name.endsWith('.js')) {
      files.push(path.join(dir, item.name));
    }
  }
  return files;
}

/**
 * Load all commands and events into the Discord client
 */
function loadBot(client) {
  // Load Events
  const eventsPath = path.join(__dirname, 'events');
  const eventFiles = getFiles(eventsPath);
  for (const filePath of eventFiles) {
    const event = require(filePath);
    if (event.name && typeof event.execute === 'function') {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      console.log(`[Bot] Loaded event: ${event.name}`);
    }
  }

  // Load Commands
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = getFiles(commandsPath);
  for (const filePath of commandFiles) {
    const command = require(filePath);
    if (command.data && typeof command.execute === 'function') {
      client.commands.set(command.data.name, command);
      console.log(`[Bot] Loaded command: /${command.data.name}`);
    }
  }

  console.log(`[Bot] Initialized ${client.commands.size} slash commands.`);
}

module.exports = { loadBot, getFiles };
