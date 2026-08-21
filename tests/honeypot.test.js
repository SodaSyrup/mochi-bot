const { TestSuite, assert } = require('./helpers/harness');
const { createTestDb } = require('./helpers/db');
const { HoneypotRepository } = require('../src/features/honeypot/infrastructure/honeypotRepository');
const { HoneypotService } = require('../src/features/honeypot/honeypotService');

function createFakeGateway() {
  let nextBannerId = 1;
  const calls = [];
  return {
    calls,
    async ensureBanner(input) {
      calls.push({ type: 'ensureBanner', ...input });
      return { id: `banner-${nextBannerId++}` };
    },
    async updateBanner(config) {
      calls.push({ type: 'updateBanner', config });
    },
    async getPermissionStatus() {
      return { viewChannel: true, sendMessages: true, embedLinks: true, banMembers: true };
    },
    async removeBanner(config) {
      calls.push({ type: 'removeBanner', config });
    },
    async softBan(message) {
      calls.push({ type: 'softBan', userId: message.author.id });
    },
  };
}

async function runHoneypotTests() {
  const suite = new TestSuite('Honeypot');

  suite.test('persists assignment and preserves the count when the same channel is reconfigured', async () => {
    const repository = new HoneypotRepository(createTestDb());
    const gateway = createFakeGateway();
    const service = new HoneypotService({ honeypotRepository: repository, honeypotGateway: gateway });

    let config = await service.configure({ guildId: 'g1', channelId: 'c1' });
    assert.strictEqual(config.kicks, 0);
    await service.handleMessage({ guildId: 'g1', channelId: 'c1', author: { id: 'u1', username: 'Alice', bot: false } });
    config = await service.configure({ guildId: 'g1', channelId: 'c1' });

    assert.strictEqual(config.kicks, 1);
    assert.strictEqual(config.banner_message_id, 'banner-2');
    assert.strictEqual(repository.getRecentKicks('g1', 'c1')[0].username, 'Alice');
    assert.strictEqual(gateway.calls.filter((call) => call.type === 'softBan').length, 1);
  });

  suite.test('ignores other channels and serializes simultaneous triggers', async () => {
    const repository = new HoneypotRepository(createTestDb());
    const gateway = createFakeGateway();
    const service = new HoneypotService({ honeypotRepository: repository, honeypotGateway: gateway });
    await service.configure({ guildId: 'g1', channelId: 'c1' });

    await Promise.all([
      service.handleMessage({ guildId: 'g1', channelId: 'c1', author: { id: 'u1', bot: false } }),
      service.handleMessage({ guildId: 'g1', channelId: 'c1', author: { id: 'u2', bot: false } }),
      service.handleMessage({ guildId: 'g1', channelId: 'c2', author: { id: 'u3', bot: false } }),
      service.handleMessage({ guildId: 'g1', channelId: 'c1', author: { id: 'bot', bot: true } }),
    ]);

    assert.strictEqual(repository.get('g1').kicks, 3);
    assert.strictEqual(gateway.calls.filter((call) => call.type === 'softBan').length, 3);
  });

  suite.test('moving to another channel starts a fresh counter', async () => {
    const repository = new HoneypotRepository(createTestDb());
    const gateway = createFakeGateway();
    const service = new HoneypotService({ honeypotRepository: repository, honeypotGateway: gateway });
    await service.configure({ guildId: 'g1', channelId: 'c1' });
    await service.handleMessage({ guildId: 'g1', channelId: 'c1', author: { id: 'u1', bot: false } });
    const moved = await service.configure({ guildId: 'g1', channelId: 'c2' });

    assert.strictEqual(moved.channel_id, 'c2');
    assert.strictEqual(moved.kicks, 0);
  });

  return suite.run();
}

runHoneypotTests();
