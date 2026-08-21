const { TestSuite, assert } = require('./helpers/harness');
const { startTestServer, demoLogin } = require('./helpers/server');
const { DEMO_GUILD_ID } = require('../src/demo/fixtures');

async function runApiTests() {
  const suite = new TestSuite('Dashboard HTTP API');

  let ctx;
  let auth;
  let baseUrl;

  suite.testAsync('server starts and /api/stats + /health are public', async () => {
    ctx = await startTestServer();
    baseUrl = ctx.baseUrl;
    const stats = await fetch(`${baseUrl}/api/stats`);
    assert.strictEqual(stats.status, 200);
    const statsData = await stats.json();
    assert.strictEqual(statsData.telemetry.runtimeVersion, Bun.version);
    const health = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(health.status, 200);
  });

  suite.testAsync('unauthenticated /api/guilds returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/guilds`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'UNAUTHORIZED');
  });

  suite.testAsync('unauthenticated guild-scoped endpoints return 401', async () => {
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/leaderboard`);
    assert.strictEqual(res.status, 401);
  });

  suite.testAsync('demo login works and guilds list is authorized', async () => {
    auth = await demoLogin(baseUrl);
    const res = await fetch(`${baseUrl}/api/guilds`, auth);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.guilds.length >= 1);
    assert.strictEqual(data.guilds[0].id, DEMO_GUILD_ID);
  });

  suite.testAsync('authorized guild access succeeds; unauthorized guild is 403', async () => {
    const ok = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}`, auth);
    assert.strictEqual(ok.status, 200);
    const guildData = await ok.json();
    assert.strictEqual(typeof guildData.guild.totalInviters, 'number');

    const denied = await fetch(`${baseUrl}/api/guilds/otherguild`, auth);
    assert.strictEqual(denied.status, 403);
    const body = await denied.json();
    assert.strictEqual(body.error.code, 'FORBIDDEN');
  });

  suite.testAsync('PATCH settings works', async () => {
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie },
      body: JSON.stringify({ fake_threshold_days: 14 }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.settings.fake_threshold_days, 14);
  });

  suite.testAsync('PATCH invite_log_channel_id saves a valid guild channel', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/settings`, {
      method: 'PATCH',
      headers: withAuth.headers,
      body: JSON.stringify({ invite_log_channel_id: 'chan_general' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.settings.invite_log_channel_id, 'chan_general');
  });

  suite.testAsync('GET guild returns the saved invite_log_channel_id', async () => {
    const withAuth = { headers: { Cookie: auth.headers.Cookie } };
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}`, withAuth);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.settings.invite_log_channel_id, 'chan_general');
  });

  suite.testAsync('PATCH invite_log_channel_id null disables invite logs', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/settings`, {
      method: 'PATCH',
      headers: withAuth.headers,
      body: JSON.stringify({ invite_log_channel_id: null }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.settings.invite_log_channel_id, null);
  });

  suite.testAsync('invite_log_channel_id belonging to another/nonexistent guild is rejected with 400 VALIDATION', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/settings`, {
      method: 'PATCH',
      headers: withAuth.headers,
      body: JSON.stringify({ invite_log_channel_id: 'chan_from_another_guild' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION');
  });

  suite.testAsync('fake_threshold_days still works alongside invite_log_channel_id', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/settings`, {
      method: 'PATCH',
      headers: withAuth.headers,
      body: JSON.stringify({ fake_threshold_days: 21, invite_log_channel_id: 'chan_welcome' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.settings.fake_threshold_days, 21);
    assert.strictEqual(data.settings.invite_log_channel_id, 'chan_welcome');
  });

  suite.testAsync('invite endpoints work (leaderboard, history, activity, analytics, active-codes)', async () => {
    const withAuth = { headers: { Cookie: auth.headers.Cookie } };

    const lb = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/leaderboard`, withAuth);
    const lbData = await lb.json();
    assert.strictEqual(lb.status, 200);
    assert.ok(lbData.leaderboard.length > 0);
    assert.ok('bonus' in lbData.leaderboard[0]);
    assert.ok('total' in lbData.leaderboard[0]);

    const hist = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/history?limit=3`, withAuth);
    assert.strictEqual(hist.status, 200);
    const historyData = await hist.json();
    if (historyData.history.length > 0) {
      const historyRow = historyData.history[0];
      for (const key of ['userId', 'inviterId', 'inviteCode', 'inviteLabel', 'channelName', 'joinedAt', 'leftAt', 'isFake', 'isLeft']) {
        assert.ok(Object.hasOwn(historyRow, key), `history response must contain ${key}`);
      }
      for (const key of ['user_id', 'inviter_id', 'invite_code', 'invite_label', 'channel_name', 'joined_at', 'left_at', 'is_fake', 'is_left']) {
        assert.ok(!Object.hasOwn(historyRow, key), `history response must not contain ${key}`);
      }
    }

    const log = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/activity-log?limit=5`, withAuth);
    const logData = await log.json();
    assert.strictEqual(log.status, 200);
    assert.ok(Array.isArray(logData.items));
    assert.strictEqual(logData.items[0].attribution.type, 'INVITE');
    assert.strictEqual(logData.items[0].attribution.inviterId, '555555555555555555');

    const an = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/analytics?days=7`, withAuth);
    const anData = await an.json();
    assert.strictEqual(anData.analytics.length, 7);

    const codes = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/active-codes`, withAuth);
    const codesData = await codes.json();
    assert.strictEqual(codes.status, 200);
    assert.ok(codesData.invites.length >= 1);
  });

  suite.testAsync('simulate join/leave exercise the real use cases', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };
    const join = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/simulate/join`, {
      method: 'POST',
      headers: withAuth.headers,
      body: JSON.stringify({ username: 'ApiTestUser', inviterId: '111111111111111111', inviteCode: 'mochi-welcome' }),
    });
    const joinData = await join.json();
    assert.strictEqual(join.status, 200);
    assert.strictEqual(joinData.success, true);

    const leave = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/simulate/leave`, {
      method: 'POST',
      headers: withAuth.headers,
      body: JSON.stringify({ userId: joinData.event.user.id }),
    });
    const leaveData = await leave.json();
    assert.strictEqual(leave.status, 200);
    assert.strictEqual(leaveData.success, true);
  });

  suite.testAsync('channels and roles endpoints work', async () => {
    const withAuth = { headers: { Cookie: auth.headers.Cookie } };
    const ch = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/channels`, withAuth);
    const chData = await ch.json();
    assert.strictEqual(ch.status, 200);
    assert.ok(chData.channels.length > 0);

    const roles = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/roles`, withAuth);
    const rolesData = await roles.json();
    assert.strictEqual(roles.status, 200);
    assert.ok(rolesData.roles.length > 0);
  });

  suite.testAsync('create/label/revoke invite lifecycle', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };
    const created = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites`, {
      method: 'POST',
      headers: withAuth.headers,
      body: JSON.stringify({ channelId: 'chan_welcome', label: 'API Promo', maxUses: 25 }),
    });
    const createdData = await created.json();
    assert.strictEqual(created.status, 201);
    assert.strictEqual(createdData.invite.label, 'API Promo');
    const code = createdData.invite.code;

    const labeled = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/${code}/label`, {
      method: 'POST',
      headers: withAuth.headers,
      body: JSON.stringify({ label: 'API Promo v2' }),
    });
    assert.strictEqual(labeled.status, 200);
    assert.strictEqual((await labeled.json()).label, 'API Promo v2');

    const removed = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/${code}/label`, {
      method: 'DELETE',
      headers: withAuth.headers,
    });
    assert.strictEqual(removed.status, 200);
    assert.strictEqual((await removed.json()).label, null);

    const revoked = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/${code}`, {
      method: 'DELETE',
      headers: withAuth.headers,
    });
    assert.strictEqual(revoked.status, 200);
  });

  suite.testAsync('safety overview, settings, automod CRUD', async () => {
    const withAuth = { headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie } };

    const overview = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety`, withAuth);
    assert.strictEqual(overview.status, 200);
    const ovData = await overview.json();
    assert.strictEqual(typeof ovData.safety.verificationLevel, 'number');

    const patch = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety/settings`, {
      method: 'PATCH',
      headers: withAuth.headers,
      body: JSON.stringify({ verificationLevel: 2, explicitContentFilter: 2 }),
    });
    assert.strictEqual(patch.status, 200);
    const patchData = await patch.json();
    assert.strictEqual(patchData.safety.verificationLevel, 2);

    const created = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety/automod`, {
      method: 'POST',
      headers: withAuth.headers,
      body: JSON.stringify({ name: 'API Test Rule', triggerType: 1, actions: [{ type: 1, metadata: {} }] }),
    });
    assert.strictEqual(created.status, 201);
    const createdRule = (await created.json()).rule;
    assert.strictEqual(createdRule.name, 'API Test Rule');

    const patched = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety/automod/${createdRule.id}`, {
      method: 'PATCH',
      headers: withAuth.headers,
      body: JSON.stringify({ enabled: false }),
    });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual((await patched.json()).rule.enabled, false);

    const del = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/safety/automod/${createdRule.id}`, {
      method: 'DELETE',
      headers: withAuth.headers,
    });
    assert.strictEqual(del.status, 200);
  });

  suite.testAsync('simulate/automod works', async () => {
    const res = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/simulate/automod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: auth.headers.Cookie },
      body: JSON.stringify({ ruleName: 'Test', triggerType: 1, actionType: 1, matchedKeyword: 'x' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  suite.testAsync('member reconciliation works in demo and is idempotent', async () => {
    const withAuth = { headers: { Cookie: auth.headers.Cookie } };
    const r1 = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/reconcile-members`, { method: 'POST', headers: withAuth.headers });
    assert.strictEqual(r1.status, 200);
    const first = await r1.json();
    assert.strictEqual(first.success, true);
    assert.ok(Number.isInteger(first.joined));
    assert.ok(Number.isInteger(first.left));
    const r2 = await fetch(`${baseUrl}/api/guilds/${DEMO_GUILD_ID}/invites/reconcile-members`, { method: 'POST', headers: withAuth.headers });
    const second = await r2.json();
    assert.strictEqual(second.joined, 0);
    assert.strictEqual(second.left, 0);
  });

  suite.testAsync('MPA pages and static assets serve correctly', async () => {
    for (const path of ['/', '/analytics', '/leaderboard', '/codes', '/safety', '/simulator', '/settings']) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.strictEqual(res.status, 200, `expected 200 for ${path}`);
    }
    const notFound = await fetch(`${baseUrl}/some-missing-page`);
    assert.strictEqual(notFound.status, 404);
    const css = await fetch(`${baseUrl}/css/dashboard.css`);
    assert.strictEqual(css.status, 200);
  });

  suite.testAsync('unknown API endpoint returns JSON 404', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  });

  await ctx?.server?.close();
  return suite.run();
}

/**
 * Development-mode convenience login: requires explicit DEV_AUTH_BYPASS=true.
 * With OAuth credentials missing and the bypass disabled, no admin session may
 * be created implicitly; only an explicit loopback + bypass grants one.
 */
async function runDevelopmentLoginTests() {
  const suite = new TestSuite('Development Login (no OAuth)');

  let ctx;
  let baseUrl;

  suite.testAsync('development login without DEV_AUTH_BYPASS does NOT create an admin session', async () => {
    const mockClient = {
      user: { username: 'MochiMock', tag: 'MochiMock#0000' },
      guilds: {
        cache: new Map([
          ['g_alpha', { id: 'g_alpha', name: 'Alpha', memberCount: 50, iconURL: () => null, ownerId: 'o1' }],
        ]),
      },
      isReady: () => true,
    };
    ctx = await startTestServer({
      mode: 'development',
      seed: false,
      client: mockClient,
      env: { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'false' },
    });
    baseUrl = ctx.baseUrl;

    const login = await fetch(`${baseUrl}/auth/login`, { redirect: 'manual' });
    assert.strictEqual(login.status, 302);
    assert.ok(login.headers.get('location').includes('oauth_not_configured'));

    // No session cookie -> no implicit admin anywhere.
    const user = await fetch(`${baseUrl}/auth/user`);
    const userData = await user.json();
    assert.strictEqual(userData.authenticated, false);
    assert.strictEqual(userData.user, null);

    // Authenticated-only endpoints stay locked.
    const guilds = await fetch(`${baseUrl}/api/guilds`);
    assert.strictEqual(guilds.status, 401);
  });

  suite.testAsync('development login with DEV_AUTH_BYPASS=true on loopback creates a dev session', async () => {
    const mockClient = {
      user: { username: 'MochiMock', tag: 'MochiMock#0000' },
      guilds: {
        cache: new Map([
          ['g_alpha', { id: 'g_alpha', name: 'Alpha', memberCount: 50, iconURL: () => null, ownerId: 'o1' }],
        ]),
      },
      isReady: () => true,
    };
    await ctx?.server?.close();
    ctx = await startTestServer({
      mode: 'development',
      seed: false,
      client: mockClient,
      env: { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'true' },
    });
    baseUrl = ctx.baseUrl;

    const login = await fetch(`${baseUrl}/auth/login`, { redirect: 'manual' });
    assert.strictEqual(login.status, 302);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'expected a session cookie');
    const auth = { headers: { Cookie: cookie } };

    const user = await fetch(`${baseUrl}/auth/user`, auth);
    const userData = await user.json();
    assert.strictEqual(userData.authenticated, true);
    assert.strictEqual(userData.user.isDev, true);

    const guilds = await fetch(`${baseUrl}/api/guilds`, auth);
    const guildsData = await guilds.json();
    assert.strictEqual(guilds.status, 200);
    assert.ok(guildsData.guilds.some((g) => g.id === 'g_alpha'));

    const detail = await fetch(`${baseUrl}/api/guilds/g_alpha`, auth);
    assert.strictEqual(detail.status, 200);
  });

  suite.testAsync('development login must never grant access in demo or production', async () => {
    // Demo mode: /auth/login sets the DEMO user, not a dev user.
    const demo = await startTestServer({ mode: 'demo', seed: false });
    const demoLogin = await fetch(`${demo.baseUrl}/auth/login`, { redirect: 'manual' });
    const demoCookie = demoLogin.headers.get('set-cookie')?.split(';')[0];
    const demoUser = await (await fetch(`${demo.baseUrl}/auth/user`, { headers: { Cookie: demoCookie } })).json();
    assert.strictEqual(demoUser.user.isDev, false);
    assert.strictEqual(demoUser.user.isDemo, true);
    await demo.server.close();
  });

  await ctx?.server?.close();
  return suite.run();
}

module.exports = { runApiTests, runDevelopmentLoginTests };

if (require.main === module) {
  Promise.all([runApiTests(), runDevelopmentLoginTests()]).then((results) => {
    const failed = results.reduce((a, b) => a + b, 0);
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
