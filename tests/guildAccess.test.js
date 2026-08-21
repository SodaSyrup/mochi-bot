const { TestSuite, assert } = require('./helpers/harness');
const { GuildAccessService } = require('../src/dashboard/auth/guildAccessService');
const { PermissionFlagsBits } = require('discord.js');

const ADMIN = String(PermissionFlagsBits.Administrator);

async function runGuildAccessTests() {
  const suite = new TestSuite('Guild Access Service');

  suite.test('lists only guilds that are manageable AND have the bot', async () => {
    const gateway = {
      async listGuilds() {
        return [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
          { id: 'c', name: 'C' },
        ];
      },
    };
    const access = new GuildAccessService({ guildGateway: gateway });
    const user = {
      id: 'u',
      discordGuilds: [
        { id: 'a', name: 'A', owner: true, permissions: '0' },       // manageable + bot in it
        { id: 'b', name: 'B', owner: false, permissions: ADMIN },     // manageable + bot in it
        { id: 'd', name: 'D', owner: true, permissions: '0' },        // manageable but bot NOT in it
        { id: 'e', name: 'E', owner: false, permissions: '0' },       // not manageable
      ],
    };
    const guilds = await access.listManageableGuilds(user);
    const ids = guilds.map((g) => g.id).sort();
    assert.deepStrictEqual(ids, ['a', 'b']);
  });

  suite.test('canManageGuild reflects the intersection rule', async () => {
    const gateway = {
      async listGuilds() {
        return [{ id: 'a', name: 'A' }];
      },
    };
    const access = new GuildAccessService({ guildGateway: gateway });
    const user = { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }] };
    assert.strictEqual(await access.canManageGuild(user, 'a'), true);
    assert.strictEqual(await access.canManageGuild(user, 'b'), false);
    assert.strictEqual(await access.canManageGuild({}, 'a'), false);
  });

  suite.test('server owner is recognized from the bot guild ownerId', async () => {
    const gateway = {
      async listGuilds() {
        return [{ id: 'a', name: 'A', ownerId: 'server-owner' }];
      },
    };
    const access = new GuildAccessService({ guildGateway: gateway });
    const owner = { id: 'server-owner', discordGuilds: [{ id: 'a', name: 'A', owner: false, permissions: '0' }] };
    const nonOwner = { id: 'different-user', discordGuilds: [{ id: 'a', name: 'A', owner: false, permissions: '0' }] };

    assert.strictEqual(await access.canManageGuild(owner, 'a'), true);
    assert.strictEqual(await access.canManageGuild(nonOwner, 'a'), false);
  });

  suite.test('development dev-login session can manage every bot guild (development only)', async () => {
    const gateway = {
      async listGuilds() {
        return [
          { id: 'botguild1', name: 'Bot Guild 1', memberCount: 10 },
          { id: 'botguild2', name: 'Bot Guild 2', memberCount: 20 },
        ];
      },
    };
    const devAccess = new GuildAccessService({ guildGateway: gateway, isDevelopment: true });
    const devUser = { id: 'dev', isDev: true, discordGuilds: [] };
    const guilds = await devAccess.listManageableGuilds(devUser);
    assert.deepStrictEqual(guilds.map((g) => g.id).sort(), ['botguild1', 'botguild2']);
    assert.strictEqual(await devAccess.canManageGuild(devUser, 'botguild1'), true);

    // A non-dev session in development still uses the normal intersection rule.
    const normalUser = { id: 'u', discordGuilds: [{ id: 'botguild1', name: 'BG1', owner: true, permissions: '0' }] };
    assert.strictEqual(await devAccess.canManageGuild(normalUser, 'botguild1'), true);
    assert.strictEqual(await devAccess.canManageGuild(normalUser, 'botguild2'), false);

    // Dev sessions must NOT grant access in non-development (live) mode.
    const liveAccess = new GuildAccessService({ guildGateway: gateway, isDevelopment: false });
    assert.strictEqual(await liveAccess.canManageGuild(devUser, 'botguild1'), false);
  });

  return suite.run();
}

module.exports = { runGuildAccessTests };

if (require.main === module) {
  runGuildAccessTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
