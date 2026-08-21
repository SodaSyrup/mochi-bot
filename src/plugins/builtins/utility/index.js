const botinfo = require('../../../bot/commands/utility/botinfo');
const help = require('../../../bot/commands/utility/help');
const ping = require('../../../bot/commands/utility/ping');
const serverinfo = require('../../../bot/commands/utility/serverinfo');
const userinfo = require('../../../bot/commands/utility/userinfo');

const commands = [botinfo, help, ping, serverinfo, userinfo];

module.exports = {
  manifest: {
    id: 'utility',
    name: 'Utility',
    version: '1.0.0',
    apiVersion: 1,
    description: 'General-purpose Mochi commands.',
    requires: [],
  },
  migrations: [],
  register(context) {
    for (const command of commands) {
      context.commands.register(command, { source: `src/bot/commands/utility/${command.data.name}.js` });
    }
    context.pages.register({ id: 'overview', path: '/', file: 'overview.html' });
    context.pages.register({ id: 'settings', path: '/settings', file: 'settings.html' });
  },
};
