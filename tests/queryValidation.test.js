const { TestSuite, assert } = require('./helpers/harness');
const { startTestServer, demoLogin } = require('./helpers/server');
const { parseBoundedInt } = require('../src/dashboard/http/parseBoundedInt');
const { ValidationError } = require('../src/dashboard/errors');
const { DEMO_GUILD_ID } = require('../src/demo/fixtures');

async function runQueryValidationTests() {
  const suite = new TestSuite('Query & Pagination Validation');

  suite.test('parseBoundedInt unit behavior', () => {
    assert.strictEqual(parseBoundedInt(undefined, { defaultValue: 10, min: 1, max: 100, name: 'limit' }), 10);
    assert.strictEqual(parseBoundedInt('10', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), 10);
    assert.strictEqual(parseBoundedInt('', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), 10);
    assert.throws(() => parseBoundedInt('-5', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.throws(() => parseBoundedInt('abc', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.throws(() => parseBoundedInt('3.7', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.throws(() => parseBoundedInt('101', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.throws(() => parseBoundedInt('0', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.throws(() => parseBoundedInt('Infinity', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.throws(() => parseBoundedInt('NaN', { defaultValue: 10, min: 1, max: 100, name: 'limit' }), ValidationError);
    assert.strictEqual(parseBoundedInt('0', { defaultValue: 0, min: 0, max: 1000000, name: 'offset' }), 0);
    assert.strictEqual(parseBoundedInt(7, { defaultValue: 7, min: 1, max: 90, name: 'days' }), 7);
  });

  suite.test('malformed/negative/overflow limits never reach SQLite (HTTP 400)', async () => {
    const ctx = await startTestServer();
    const auth = await demoLogin(ctx.baseUrl);
    const url = `${ctx.baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/leaderboard`;

    const cases = ['-1', '0', 'abc', '999999', '3.7', 'Infinity'];
    for (const value of cases) {
      const res = await fetch(`${url}?limit=${value}`, auth);
      assert.strictEqual(res.status, 400, `limit=${value} should be rejected`);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'VALIDATION');
    }

    const ok = await fetch(`${url}?limit=10`, auth);
    assert.strictEqual(ok.status, 200);
    assert.ok(Array.isArray((await ok.json()).leaderboard));

    await ctx.server.close();
  });

  suite.test('activity-log offset and limit are validated consistently', async () => {
    const ctx = await startTestServer();
    const auth = await demoLogin(ctx.baseUrl);
    const url = `${ctx.baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/activity-log`;

    assert.strictEqual((await fetch(`${url}?offset=-1`, auth)).status, 400);
    assert.strictEqual((await fetch(`${url}?offset=abc`, auth)).status, 400);
    assert.strictEqual((await fetch(`${url}?limit=999999`, auth)).status, 400);
    assert.strictEqual((await fetch(`${url}?limit=-1`, auth)).status, 400);

    const ok = await fetch(`${url}?limit=5&offset=0`, auth);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).limit, 5);

    await ctx.server.close();
  });

  suite.test('analytics days is bounded (1..90)', async () => {
    const ctx = await startTestServer();
    const auth = await demoLogin(ctx.baseUrl);
    const url = `${ctx.baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/analytics`;

    assert.strictEqual((await fetch(`${url}?days=0`, auth)).status, 400);
    assert.strictEqual((await fetch(`${url}?days=-2`, auth)).status, 400);
    assert.strictEqual((await fetch(`${url}?days=91`, auth)).status, 400);
    assert.strictEqual((await fetch(`${url}?days=abc`, auth)).status, 400);

    const ok = await fetch(`${url}?days=7`, auth);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).analytics.length, 7);

    await ctx.server.close();
  });

  return suite.run();
}

module.exports = { runQueryValidationTests };

if (require.main === module) {
  runQueryValidationTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
