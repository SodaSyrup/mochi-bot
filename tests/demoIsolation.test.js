const { TestSuite, assert } = require('./helpers/harness');
const { buildConfig } = require('../src/config');
const { createTestDb } = require('./helpers/db');
const { createEventBus } = require('../src/app/eventBus');
const { createServices } = require('../src/app/createServices');
const { silentLogger } = require('./helpers/server');
const { DemoGuildGateway } = require('../src/demo/demoGuildGateway');
const { DemoInviteGateway } = require('../src/demo/demoInviteGateway');
const { DemoSafetyGateway } = require('../src/demo/demoSafetyGateway');
const { DemoInviteLogGateway } = require('../src/demo/demoInviteLogGateway');
const { DiscordInviteLogGateway } = require('../src/platform/discord/discordInviteLogGateway');
const { DEMO_GUILD_ID } = require('../src/demo/fixtures');

function buildServices(mode) {
  const config = buildConfig({ ...process.env, APP_MODE: mode });
  const db = createTestDb();
  const eventBus = createEventBus();
  return createServices({ config, db, eventBus, client: null, logger: silentLogger });
}

async function runDemoIsolationTests() {
  const suite = new TestSuite('Demo / Live Isolation');

  suite.test('demo mode selects demo gateways during composition', () => {
    const services = buildServices('demo');
    assert.ok(services.guildGateway instanceof DemoGuildGateway);
    assert.ok(services.inviteGateway instanceof DemoInviteGateway);
    assert.ok(services.safetyGateway instanceof DemoSafetyGateway);
    assert.ok(services.inviteLogGateway instanceof DemoInviteLogGateway);
  });

  suite.test('development/production modes select Discord gateways, never demo', () => {
    const services = buildServices('development');
    assert.ok(!(services.guildGateway instanceof DemoGuildGateway));
    assert.ok(!(services.inviteGateway instanceof DemoInviteGateway));
    assert.ok(!(services.safetyGateway instanceof DemoSafetyGateway));
    assert.ok(services.inviteLogGateway instanceof DiscordInviteLogGateway);
    assert.ok(!(services.inviteLogGateway instanceof DemoInviteLogGateway));
  });

  suite.test('demo invite log gateway never touches a Discord client', async () => {
    const services = buildServices('demo');
    const ok = await services.inviteLogGateway.sendMessage('g', 'c', 'hello');
    assert.strictEqual(ok, true);
    assert.strictEqual(services.inviteLogGateway.sent.length, 1);
    assert.strictEqual(await services.inviteLogGateway.findRecentBotAdder('g', 'b'), null);
  });

  suite.test('live safety operation with no Discord connection errors instead of simulating', async () => {
    const services = buildServices('development');
    await assert.rejects(
      services.safety.getOverview(DEMO_GUILD_ID),
      /not available/i
    );
    await assert.rejects(
      services.safety.listRules(DEMO_GUILD_ID),
      /not available/i
    );
  });

  suite.test('live invite creation with no Discord connection fails loudly', async () => {
    const services = buildServices('development');
    await assert.rejects(
      services.invites.createInvite({ guildId: DEMO_GUILD_ID, channelId: 'x' }),
      /not in this guild/i
    );
  });

  suite.test('demo safety operations succeed through demo gateways', async () => {
    const services = buildServices('demo');
    const overview = await services.safety.getOverview(DEMO_GUILD_ID);
    assert.strictEqual(overview.isSimulated, true);
    assert.strictEqual(overview.rulesCount, 4);
  });

  return suite.run();
}

module.exports = { runDemoIsolationTests };

if (require.main === module) {
  runDemoIsolationTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
