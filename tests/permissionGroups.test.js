const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb } = require('./helpers/db');
const permissionGroupsPlugin = require('../src/plugins/builtins/permission-groups');
const { runPluginMigrations } = require('../src/plugins/core/pluginMigrationRunner');
const { PermissionGroupRepository } = require('../src/features/permissionGroups/infrastructure/permissionGroupRepository');
const { PermissionGroupService } = require('../src/features/permissionGroups/permissionGroupService');
const { DiscordPermissionGroupGateway } = require('../src/platform/discord/discordPermissionGroupGateway');
const { ChannelType } = require('discord.js');

function fixture() {
  const db = createTestDb();
  runPluginMigrations(db, [permissionGroupsPlugin], { silent: true });
  const repository = new PermissionGroupRepository(db);
  const calls = [];
  const gateway = {
    async getConfiguration() {
      return {
        categories: [
          { id: 'cat-1', name: 'Project One' },
          { id: 'cat-2', name: 'Project Two' },
          { id: 'cat-3', name: 'Project Three' },
        ],
        channels: [
          { id: 'announcements', name: 'announcements', type: 5, parentId: 'cat-1' },
          { id: 'chat', name: 'chat', type: 0, parentId: 'cat-1' },
        ],
        roles: [
          { id: 'studio', name: 'Modding Studio' },
          { id: 'partner', name: 'Partner Studio' },
        ],
      };
    },
    async apply(guildId, previous, desired) {
      calls.push({ guildId, previous, desired });
      return true;
    },
  };
  return { db, repository, calls, service: new PermissionGroupService({ repository, gateway, logger: { error() {} } }) };
}

async function runPermissionGroupTests() {
  const suite = new TestSuite('Permission Groups');

  suite.testAsync('creates a shared layer and persists permission states', async () => {
    const { service, repository, calls } = fixture();
    const group = await service.create('guild', {
      name: 'Projects',
      categoryIds: ['cat-1', 'cat-2'],
      rules: [{ roleId: 'studio', permissions: { ViewChannel: 'allow', SendMessages: 'deny' } }],
    });
    assert.strictEqual(group.name, 'Projects');
    assert.deepStrictEqual(group.categoryIds, ['cat-1', 'cat-2']);
    assert.strictEqual(group.rules[0].permissions.ViewChannel, 'allow');
    assert.strictEqual(group.rules[0].permissions.SendMessages, 'deny');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].previous, null);
    assert.ok(repository.get('guild', group.id));
  });

  suite.testAsync('keeps a role entry even when its permissions start as inherit', async () => {
    const { service } = fixture();
    const group = await service.create('guild', {
      name: 'Projects',
      categoryIds: ['cat-1'],
      rules: [{ roleId: 'studio', permissions: {} }],
    });
    assert.strictEqual(group.rules.length, 1);
    assert.strictEqual(group.rules[0].roleId, 'studio');
    assert.strictEqual(group.rules[0].permissions.ViewChannel, 'inherit');
  });

  suite.testAsync('edit passes the prior layer so removed bits and categories can be cleared', async () => {
    const { service, calls } = fixture();
    const created = await service.create('guild', {
      name: 'Projects',
      categoryIds: ['cat-1', 'cat-2'],
      rules: [{ roleId: 'studio', permissions: { ViewChannel: 'allow' } }],
    });
    const updated = await service.update('guild', created.id, {
      name: 'Studios',
      categoryIds: ['cat-1', 'cat-3'],
      rules: [{ roleId: 'partner', permissions: { ViewChannel: 'allow' } }],
    });
    assert.strictEqual(updated.name, 'Studios');
    assert.deepStrictEqual(calls[1].previous.categoryIds, ['cat-1', 'cat-2']);
    assert.deepStrictEqual(calls[1].desired.categoryIds, ['cat-1', 'cat-3']);
  });

  suite.testAsync('supports a channel-specific rule inside a selected category', async () => {
    const { service, calls } = fixture();
    const group = await service.create('guild', {
      name: 'Projects',
      categoryIds: ['cat-1'],
      rules: [{ targetType: 'channel', targetId: 'announcements', roleId: 'studio', permissions: { SendMessages: 'deny' } }],
    });
    assert.strictEqual(group.rules[0].targetType, 'channel');
    assert.strictEqual(group.rules[0].targetId, 'announcements');
    assert.strictEqual(calls[0].desired.rules[0].targetId, 'announcements');
  });

  suite.testAsync('one category cannot be controlled by competing groups', async () => {
    const { service } = fixture();
    await service.create('guild', { name: 'A', categoryIds: ['cat-1'], rules: [] });
    await assert.rejects(
      () => service.create('guild', { name: 'B', categoryIds: ['cat-1'], rules: [] }),
      (error) => error.code === 'CONFLICT'
    );
  });

  suite.testAsync('sync reapplies stored rules and delete clears them before removing data', async () => {
    const { service, repository, calls } = fixture();
    const group = await service.create('guild', {
      name: 'Projects', categoryIds: ['cat-1'], rules: [{ roleId: 'studio', permissions: { ViewChannel: 'allow' } }],
    });
    await service.sync('guild', group.id);
    assert.strictEqual(calls[1].previous, null);
    await service.delete('guild', group.id);
    assert.deepStrictEqual(calls[2].desired, { categoryIds: [], rules: [] });
    assert.strictEqual(repository.get('guild', group.id), null);
  });

  suite.testAsync('Discord adapter changes only group-owned permission keys', async () => {
    const edits = [];
    const category = {
      id: 'cat-1',
      type: ChannelType.GuildCategory,
      permissionOverwrites: { async edit(roleId, permissions, options) { edits.push({ roleId, permissions, options }); } },
    };
    const guild = {
      channels: { cache: new Map([[category.id, category]]) },
      members: { me: { permissions: { has: () => true } } },
    };
    const gateway = new DiscordPermissionGroupGateway({ client: { guilds: { cache: new Map([['guild', guild]]) } } });
    await gateway.apply('guild', {
      categoryIds: ['cat-1'],
      rules: [{ roleId: 'studio', allow: '1024', deny: '2048' }],
    }, {
      categoryIds: ['cat-1'],
      rules: [{ roleId: 'studio', allow: '0', deny: '1024' }],
    });
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0].permissions.ViewChannel, false);
    assert.strictEqual(edits[0].permissions.SendMessages, null);
    assert.strictEqual(Object.keys(edits[0].permissions).length, 2);
    assert.strictEqual(edits[0].options.reason, 'Synced from a Mochi permission group');
  });

  suite.testAsync('Discord adapter creates a role overwrite for an all-inherit group member', async () => {
    const edits = [];
    const category = {
      id: 'cat-1',
      type: ChannelType.GuildCategory,
      permissionOverwrites: { async edit(roleId, permissions) { edits.push({ roleId, permissions }); } },
    };
    const guild = {
      channels: { cache: new Map([[category.id, category]]) },
      members: { me: { permissions: { has: () => true } } },
    };
    const gateway = new DiscordPermissionGroupGateway({ client: { guilds: { cache: new Map([['guild', guild]]) } } });
    await gateway.apply('guild', null, { categoryIds: ['cat-1'], rules: [{ roleId: 'studio', allow: '0', deny: '0' }] });
    assert.deepStrictEqual(edits, [{ roleId: 'studio', permissions: {} }]);
  });

  suite.testAsync('Discord adapter exposes the complete category and child-channel layout', async () => {
    const guild = {
      id: 'guild',
      channels: { cache: new Map([
        ['cat-2', { id: 'cat-2', name: 'Second', type: ChannelType.GuildCategory, position: 4, isThread: () => false }],
        ['voice', { id: 'voice', name: 'Voice', type: ChannelType.GuildVoice, parentId: 'cat-2', position: 2, isThread: () => false }],
        ['cat-1', { id: 'cat-1', name: 'First', type: ChannelType.GuildCategory, position: 1, isThread: () => false }],
        ['chat', { id: 'chat', name: 'chat', type: ChannelType.GuildText, parentId: 'cat-1', position: 1, isThread: () => false }],
        ['loose', { id: 'loose', name: 'welcome', type: ChannelType.GuildText, parentId: null, position: 0, isThread: () => false }],
        ['thread', { id: 'thread', name: 'hidden thread', type: ChannelType.PublicThread, parentId: 'chat', position: 0, isThread: () => true }],
      ]) },
      roles: { cache: new Map([
        ['guild', { id: 'guild', name: '@everyone', managed: false, hexColor: '#000000', position: 0 }],
        ['studio', { id: 'studio', name: 'Studio', managed: false, hexColor: '#ff0000', position: 2 }],
      ]) },
    };
    const gateway = new DiscordPermissionGroupGateway({ client: { guilds: { cache: new Map([['guild', guild]]) } } });
    const configuration = await gateway.getConfiguration('guild');
    assert.deepStrictEqual(configuration.categories.map((category) => category.id), ['cat-1', 'cat-2']);
    assert.deepStrictEqual(configuration.channels.map((channel) => channel.id), ['loose', 'chat', 'voice']);
    assert.strictEqual(configuration.channels[1].parentId, 'cat-1');
    assert.strictEqual(configuration.roles.find((role) => role.id === 'guild').name, '@everyone');
  });

  suite.testAsync('Discord adapter refreshes channel and role collections before building the layout', async () => {
    let channelFetches = 0;
    let roleFetches = 0;
    const category = { id: 'cat-1', name: 'Fetched category', type: ChannelType.GuildCategory, position: 1, isThread: () => false };
    const channel = { id: 'chat', name: 'Fetched channel', type: ChannelType.GuildText, parentId: 'cat-1', position: 1, isThread: () => false };
    const role = { id: 'studio', name: 'Studio', managed: false, hexColor: '#ff0000', position: 2 };
    const guild = {
      id: 'guild',
      channels: { cache: new Map(), fetch: async () => { channelFetches += 1; return new Map([[category.id, category], [channel.id, channel]]); } },
      roles: { cache: new Map(), fetch: async () => { roleFetches += 1; return new Map([['guild', { id: 'guild', name: '@everyone', managed: false, hexColor: '#000000', position: 0 }], [role.id, role]]); } },
    };
    const gateway = new DiscordPermissionGroupGateway({ client: { guilds: { cache: new Map([['guild', guild]]) } } });
    const configuration = await gateway.getConfiguration('guild');
    assert.strictEqual(channelFetches, 1);
    assert.strictEqual(roleFetches, 1);
    assert.deepStrictEqual(configuration.channels.map((item) => item.id), ['chat']);
    assert.strictEqual(configuration.categories[0].name, 'Fetched category');
    assert.strictEqual(configuration.roles.find((item) => item.id === 'studio').name, 'Studio');
  });

  suite.testAsync('Discord adapter reads existing role overwrites for dashboard editing', async () => {
    const category = {
      id: 'cat-1', name: 'First', type: ChannelType.GuildCategory, position: 1, isThread: () => false,
      permissionOverwrites: { cache: new Map([{
        id: 'studio', type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 2048n },
      }].map((overwrite) => [overwrite.id, overwrite])) },
    };
    const role = { id: 'studio', name: 'Studio', managed: false, hexColor: '#ff0000', position: 2 };
    const guild = {
      id: 'guild',
      channels: { cache: new Map([[category.id, category]]) },
      roles: { cache: new Map([['guild', { id: 'guild', name: '@everyone', managed: false, hexColor: '#000000', position: 0 }], ['studio', role]]) },
    };
    const gateway = new DiscordPermissionGroupGateway({ client: { guilds: { cache: new Map([['guild', guild]]) } } });
    const configuration = await gateway.getConfiguration('guild');
    assert.strictEqual(configuration.overwrites.length, 1);
    assert.strictEqual(configuration.overwrites[0].targetType, 'category');
    assert.strictEqual(configuration.overwrites[0].roleName, 'Studio');
    assert.strictEqual(configuration.overwrites[0].allow, '1024');
    assert.strictEqual(configuration.overwrites[0].deny, '2048');
  });

  return suite.run();
}

module.exports = { runPermissionGroupTests };

if (require.main === module) {
  runPermissionGroupTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
