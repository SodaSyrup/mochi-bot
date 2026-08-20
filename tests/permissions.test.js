const { TestSuite, assert } = require('./helpers/harness');
const { parsePermissions, canManageGuild, generateOAuthState } = require('../src/dashboard/auth/permissions');
const { PermissionFlagsBits } = require('discord.js');

const ADMIN = String(PermissionFlagsBits.Administrator);
const MANAGE_GUILD = String(PermissionFlagsBits.ManageGuild);
const SEND_MESSAGES = String(PermissionFlagsBits.SendMessages);

async function runPermissionTests() {
  const suite = new TestSuite('Discord Permissions & OAuth State');

  suite.test('guild owner can manage', () => {
    assert.strictEqual(canManageGuild({ owner: true, permissions: '0' }), true);
  });

  suite.test('Administrator can manage', () => {
    assert.strictEqual(canManageGuild({ owner: false, permissions: ADMIN }), true);
  });

  suite.test('Manage Guild can manage', () => {
    assert.strictEqual(canManageGuild({ owner: false, permissions: MANAGE_GUILD }), true);
  });

  suite.test('ordinary member cannot manage', () => {
    assert.strictEqual(canManageGuild({ owner: false, permissions: SEND_MESSAGES }), false);
    assert.strictEqual(canManageGuild({ owner: false, permissions: '0' }), false);
  });

  suite.test('combined bitfields are parsed with BigInt', () => {
    const combined = (BigInt(SEND_MESSAGES) | BigInt(MANAGE_GUILD)).toString();
    assert.strictEqual(canManageGuild({ owner: false, permissions: combined }), true);
  });

  suite.test('invalid permissions string is handled safely', () => {
    assert.strictEqual(canManageGuild({ owner: false, permissions: 'not-a-number' }), false);
  });

  suite.test('OAuth state is cryptographically random', () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    assert.strictEqual(a.length, 48);
    assert.notStrictEqual(a, b);
  });

  return suite.run();
}

module.exports = { runPermissionTests };

if (require.main === module) {
  runPermissionTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
