const { TestSuite, assert } = require('./helpers/harness');
const { DiscordOAuthClient } = require('../src/dashboard/auth/discordOAuthClient');
const { publicUser, isLoopbackAddress } = require('../src/dashboard/routes/authRoutes');
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

  suite.test('exchangeCode captures refresh_token and expires_in', async () => {
    const client = makeClient([
      {
        match: (u) => u.includes('/oauth2/token'),
        respond: () => jsonResponse({ access_token: 'tok', refresh_token: 'rt', expires_in: 604800 }),
      },
    ]);
    const { refreshToken, expiresIn } = await client.exchangeCode('code-x');
    assert.strictEqual(refreshToken, 'rt');
    assert.strictEqual(expiresIn, 604800);
  });

  suite.test('refreshAccessToken exchanges a refresh token for a fresh access token', async () => {
    let seenBody = null;
    const client = makeClient([
      {
        match: (u, o) => u.includes('/oauth2/token') && o.body?.toString().includes('grant_type=refresh_token'),
        respond: (url, options) => {
          seenBody = options.body.toString();
          return jsonResponse({ access_token: 'fresh', refresh_token: 'new-rt', expires_in: 3600 });
        },
      },
    ]);
    const result = await client.refreshAccessToken('old-rt');
    assert.strictEqual(result.accessToken, 'fresh');
    assert.strictEqual(result.refreshToken, 'new-rt');
    assert.strictEqual(result.expiresIn, 3600);
    assert.ok(seenBody.includes('refresh_token=old-rt'));
  });

  suite.test('refreshAccessToken with revoked authorization throws UnauthorizedError', async () => {
    const { UnauthorizedError } = require('../src/dashboard/errors');
    const client = makeClient([
      {
        match: (u) => u.includes('/oauth2/token'),
        respond: () => jsonResponse({ error: 'invalid_grant' }, 400),
      },
    ]);
    await assert.rejects(client.refreshAccessToken('revoked'), (err) => err instanceof UnauthorizedError);
  });

  suite.test('refreshAccessToken without a refresh token fails closed', async () => {
    const { UnauthorizedError } = require('../src/dashboard/errors');
    const client = makeClient([]);
    await assert.rejects(client.refreshAccessToken(null), (err) => err instanceof UnauthorizedError);
  });

  suite.test('revokeToken best-effort does not throw and sends the token', async () => {
    let sawToken = null;
    const client = makeClient([
      {
        match: (u, o) => u.includes('/token/revoke'),
        respond: (url, options) => {
          sawToken = options.body.toString();
          return jsonResponse({}, 200);
        },
      },
    ]);
    await client.revokeToken('tok-to-revoke');
    assert.ok(sawToken.includes('token=tok-to-revoke'));
  });

  suite.test('revokeToken swallows network failures', async () => {
    const client = makeClient([]); // no route -> unexpected fetch throws
    await client.revokeToken('tok');
  });

  suite.test('fetchGuilds with a 401 responds with UnauthorizedError', async () => {
    const { UnauthorizedError } = require('../src/dashboard/errors');
    const client = makeClient([
      { match: (u) => u.includes('/users/@me/guilds'), respond: () => jsonResponse({ error: 'unauthorized' }, 401) },
    ]);
    await assert.rejects(client.fetchGuilds('bad-token'), (err) => err instanceof UnauthorizedError);
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

  suite.test('publicUser never exposes OAuth credentials or raw guild snapshots', () => {
    const out = publicUser({
      id: 'u1',
      username: 'TestUser',
      discriminator: '0',
      avatar: 'https://example.com/a.png',
      tag: 'TestUser#0',
      isDev: false,
      discordGuilds: [{ id: 'g', name: 'G' }],
    });
    assert.strictEqual(out.username, 'TestUser');
    assert.ok(!('discordGuilds' in out), 'raw permission snapshot must not leak');
    assert.ok(!('accessToken' in out) && !('refreshToken' in out));
  });

  suite.test('isLoopbackAddress accepts only loopback addresses', () => {
    assert.strictEqual(isLoopbackAddress('127.0.0.1'), true);
    assert.strictEqual(isLoopbackAddress('::1'), true);
    assert.strictEqual(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.strictEqual(isLoopbackAddress('127.0.0.2'), true);
    assert.strictEqual(isLoopbackAddress('10.0.0.5'), false);
    assert.strictEqual(isLoopbackAddress('192.168.1.10'), false);
    assert.strictEqual(isLoopbackAddress(''), false);
    assert.strictEqual(isLoopbackAddress(null), false);
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
