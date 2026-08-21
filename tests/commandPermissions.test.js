const { TestSuite, assert } = require('./helpers/harness');
const { getFiles } = require('../src/bot/handler');
const { toDeployableCommandData } = require('../src/bot/commandPolicy');

function loadCommandData() {
  return getFiles(require('path').join(__dirname, '../src/bot/commands'))
    .map((filePath) => require(filePath))
    .filter((command) => command.data && typeof command.data.toJSON === 'function')
    .map(toDeployableCommandData);
}

async function runCommandPermissionTests() {
  const suite = new TestSuite('Discord Native Command Permissions');

  suite.test('commands are deployed for guild integrations and guild channels', () => {
    const commands = loadCommandData();
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.deepStrictEqual(command.integration_types, [0]);
      assert.deepStrictEqual(command.contexts, [0]);
    }
  });

  suite.test('server-management commands advertise their native default permissions', () => {
    const commands = new Map(loadCommandData().map((command) => [command.name, command]));
    for (const name of ['invite-codes', 'invite-label', 'honeypot']) {
      assert.strictEqual(commands.get(name).default_member_permissions, '32');
    }
    for (const name of ['invites', 'leaderboard', 'serverinfo', 'userinfo', 'botinfo', 'ping', 'help']) {
      assert.strictEqual(commands.get(name).default_member_permissions, undefined);
    }
  });

  return suite.run();
}

module.exports = { runCommandPermissionTests };

if (require.main === module) {
  runCommandPermissionTests().then((failures) => {
    if (failures) process.exitCode = 1;
  });
}
