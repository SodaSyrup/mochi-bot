const { TestSuite, assert } = require('./helpers/harness');
const { buildConfig } = require('../src/config');
const { createTestDb } = require('./helpers/db');
const { createEventBus } = require('../src/app/eventBus');
const { createServices } = require('../src/app/createServices');
const { silentLogger } = require('./helpers/server');
const { startTestServer, devLogin } = require('./helpers/server');
const { DEMO_GUILD_ID } = require('./helpers/demo/fixtures');
const { DiscordGuildGateway } = require('../src/platform/discord/discordGuildGateway');
const { DiscordInviteGateway } = require('../src/platform/discord/discordInviteGateway');
const { DiscordSafetyGateway } = require('../src/platform/discord/discordSafetyGateway');
const { DiscordInviteLogGateway } = require('../src/platform/discord/discordInviteLogGateway');

function buildServices(mode) {
  const config = buildConfig({ ...process.env, APP_MODE: mode });
  const db = createTestDb();
  const eventBus = createEventBus();
  return createServices({ config, db, eventBus, client: null, logger: silentLogger });
}

async function runDemoIsolationTests() {
  const suite = new TestSuite('Live Composition');

  suite.test('development composition always uses Discord gateways', () => {
    const services = buildServices('development');
    assert.ok(services.guildGateway instanceof DiscordGuildGateway);
    assert.ok(services.inviteGateway instanceof DiscordInviteGateway);
    assert.ok(services.safetyGateway instanceof DiscordSafetyGateway);
    assert.ok(services.inviteLogGateway instanceof DiscordInviteLogGateway);
  });

  suite.test('demo app mode is rejected', () => {
    assert.throws(() => buildConfig({ APP_MODE: 'demo' }), /Invalid APP_MODE/);
  });

  suite.testAsync('live operations fail clearly when Discord is unavailable', async () => {
    const services = buildServices('development');
    await assert.rejects(services.safety.getOverview('guild'), /not available/i);
    await assert.rejects(services.invites.createInvite({ guildId: 'guild', channelId: 'channel' }), /not in this guild/i);
  });

  suite.testAsync('simulator page and endpoints no longer exist', async () => {
    const live = await startTestServer({ mode: 'development', seed: false });
    try {
      assert.strictEqual((await fetch(`${live.baseUrl}/simulator`)).status, 404);
      const auth = await devLogin(live.baseUrl);
      assert.strictEqual((await fetch(`${live.baseUrl}/api/guilds/${DEMO_GUILD_ID}/simulate/join`, auth)).status, 404);
    } finally {
      await live.server.close();
    }
  });

  return suite.run();
}

module.exports = { runDemoIsolationTests };

if (require.main === module) {
  runDemoIsolationTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
