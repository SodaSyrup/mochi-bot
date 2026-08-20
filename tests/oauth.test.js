const { TestSuite, assert } = require('./helpers/harness');
const { DiscordOAuthClient } = require('../src/dashboard/auth/discordOAuthClient');
const { silentLogger } = require('./helpers/server');

function createMockFetch(routes) {
  return async (url, options) => {
    for (const { match, respond } of routes) {
      if (match(url, options)) return respond(url, options);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeClient(routes) {
  return new DiscordOAuthClient({
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'http://localhost:3000/auth/callback',
    logger: silentLogger,
    fetchImpl: () => createMockFetch(routes),
  });
}

async function runOAuthTests() {
  const suite = new TestSuite('Discord OAuth');

  suite.test('authorize URL includes the state parameter and scopes', () => {
    const client = makeClient([]);
    const url = client.createAuthorizeUrl('state123');
    assert.ok(url.includes('state=state123'));
    assert.ok(url.includes('scope=identify+guilds'));
    assert.ok(url.includes('client_id=cid'));
    assert.ok(url.includes('redirect_uri='));
  });

  suite.test('exchangeCode returns the access token', async () => {
    const client = makeClient([
      {
        match: (u) => u.includes('/oauth2/token'),
        respond: () => jsonResponse({ access_token: 'tok123', token_type: 'Bearer' }),
      },
    ]);
    const { accessToken } = await client.exchangeCode('code-x');
    assert.strictEqual(accessToken, 'tok123');
  });

  suite.test('exchangeCode throws when Discord rejects', async () => {
    const client = makeClient([
      { match: () => true, respond: () => jsonResponse({ error: 'invalid_grant' }, 400) },
    ]);
    await assert.rejects(client.exchangeCode('bad'), /token exchange failed/i);
  });

  suite.test('fetchIdentity and fetchGuilds are authorized with the bearer token', async () => {
    let seenAuthHeader = null;
    const client = makeClient([
      {
        match: (u) => u.includes('/users/@me') && !u.includes('/guilds'),
        respond: (url, options) => {
          seenAuthHeader = options.headers.Authorization;
          return jsonResponse({ id: 'u1', username: 'TestUser', discriminator: '0' });
        },
      },
      {
        match: (u) => u.includes('/users/@me/guilds'),
        respond: () => jsonResponse([{ id: 'g1', name: 'G', owner: true, permissions: '0' }]),
      },
    ]);
    const identity = await client.fetchIdentity('tok');
    const guilds = await client.fetchGuilds('tok');
    assert.strictEqual(seenAuthHeader, 'Bearer tok');
    assert.strictEqual(identity.id, 'u1');
    assert.strictEqual(guilds[0].id, 'g1');
  });

  suite.test('client reports disabled when credentials are missing', () => {
    const client = new DiscordOAuthClient({ clientId: '', clientSecret: '', redirectUri: 'x', logger: silentLogger });
    assert.strictEqual(client.enabled, false);
  });

  suite.testAsync('callback rejects a missing/invalid OAuth state', async () => {
    const { startTestServer } = require('./helpers/server');
    const ctx = await startTestServer({ mode: 'development', seed: false });
    const base = ctx.baseUrl;

    // No session and/or no matching state -> rejected.
    const noState = await fetch(`${base}/auth/callback?code=abc`, { redirect: 'manual' });
    assert.strictEqual(noState.status, 302);
    assert.ok(noState.headers.get('location').includes('invalid_state'));

    const badState = await fetch(`${base}/auth/callback?code=abc&state=forged`, { redirect: 'manual' });
    assert.strictEqual(badState.status, 302);
    assert.ok(badState.headers.get('location').includes('invalid_state'));

    await ctx.server.close();
  });

  suite.testAsync('login reuses the pending OAuth state across repeated hits', async () => {
    const { startTestServer } = require('./helpers/server');
    // Force OAuth on with dummy credentials so /auth/login builds a Discord URL.
    const ctx = await startTestServer({
      mode: 'development',
      seed: false,
      env: { CLIENT_ID: 'cid', CLIENT_SECRET: 'sec' },
    });
    const base = ctx.baseUrl;

    const first = await fetch(`${base}/auth/login`, { redirect: 'manual' });
    const cookie = first.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'expected a session cookie');
    const state1 = new URL(first.headers.get('location')).searchParams.get('state');

    const second = await fetch(`${base}/auth/login`, { redirect: 'manual', headers: { Cookie: cookie } });
    const state2 = new URL(second.headers.get('location')).searchParams.get('state');

    assert.ok(state1, 'first login must carry a state');
    assert.strictEqual(state2, state1, 'pending state must be reused, not regenerated');

    await ctx.server.close();
  });

  return suite.run();
}

module.exports = { runOAuthTests };

if (require.main === module) {
  runOAuthTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
