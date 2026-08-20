const { TestSuite, assert } = require('./helpers/harness');
const { createFakeClock } = require('./helpers/fakes');
const { GuildAccessService } = require('../src/dashboard/auth/guildAccessService');
const { GuildPermissionService } = require('../src/dashboard/auth/guildPermissionService');
const { UnauthorizedError, ExternalServiceError } = require('../src/dashboard/errors');
const { PermissionFlagsBits } = require('discord.js');

const ADMIN = String(PermissionFlagsBits.Administrator);
const MINUTE = 60 * 1000;

function makeOAuthClient({ guilds = [], failWith = null, refreshCalls = [] } = {}) {
  const calls = { guildFetches: 0, refreshCalls: 0 };
  return {
    calls,
    async fetchGuilds() {
      calls.guildFetches += 1;
      if (failWith) throw failWith;
      return guilds;
    },
    async refreshAccessToken(refreshToken) {
      calls.refreshCalls += 1;
      refreshCalls.push(refreshToken);
      if (failWith) throw failWith;
      return { accessToken: 'refreshed-token', refreshToken, expiresIn: 3600 };
    },
  };
}

function makeGateway(botGuildIds = ['a', 'b', 'c']) {
  return {
    async listGuilds() {
      return botGuildIds.map((id) => ({ id, name: id }));
    },
  };
}

function makeSession({ fetchedAtMs, user = {} }) {
  return {
    user: { ...user },
    discordOAuth: {
      accessToken: 'tok',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600 * 1000,
      guildPermissionsFetchedAt: fetchedAtMs,
    },
  };
}

async function runPermissionFreshnessTests() {
  const suite = new TestSuite('Guild Permission Freshness');

  suite.testAsync('fresh snapshot is not refetched from Discord', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({
      guilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    const session = makeSession({
      fetchedAtMs: clock.now() - 2 * MINUTE, // 2 min ago, TTL 10 min -> fresh
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }] },
    });

    assert.strictEqual(await access.canManageGuild(session, 'a'), true);
    assert.strictEqual(await access.canManageGuild(session, 'a'), true);
    assert.strictEqual(oauth.calls.guildFetches, 0, 'fresh snapshot must not hit Discord');
  });

  suite.testAsync('expired snapshot is refreshed from Discord', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({
      guilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    const session = makeSession({
      fetchedAtMs: clock.now() - 20 * MINUTE, // expired
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }] },
    });

    assert.strictEqual(await access.canManageGuild(session, 'a'), true);
    assert.strictEqual(oauth.calls.guildFetches, 1, 'expired snapshot must refetch');
    assert.strictEqual(session.discordOAuth.guildPermissionsFetchedAt, clock.now());
  });

  suite.testAsync('revoked Manage Guild permission removes access and updates snapshot', async () => {
    const clock = createFakeClock(Date.now());
    // Fresh Discord response: user can NO longer manage guild 'a'.
    const oauth = makeOAuthClient({
      guilds: [{ id: 'a', name: 'A', owner: false, permissions: '0' }],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    const session = makeSession({
      fetchedAtMs: clock.now() - 20 * MINUTE, // expired so we refresh
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: false, permissions: ADMIN }] },
    });

    assert.strictEqual(await access.canManageGuild(session, 'a'), false, 'revoked permission must deny');
    assert.deepStrictEqual(session.user.discordGuilds, [{ id: 'a', name: 'A', icon: undefined, owner: false, permissions: '0' }]);
  });

  suite.testAsync('fresh snapshot lacking guild B denies B without refetching', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({
      guilds: [{ id: 'b', name: 'B', owner: false, permissions: ADMIN }],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    // Fresh snapshot (2 min ago) that predates the grant for guild B.
    const session = makeSession({
      fetchedAtMs: clock.now() - 2 * MINUTE,
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: false, permissions: ADMIN }] },
    });

    assert.strictEqual(await access.canManageGuild(session, 'b'), false, 'fresh snapshot must not refetch or grant B');
    assert.strictEqual(oauth.calls.guildFetches, 0);
  });

  suite.testAsync('newly granted permission becomes available after the snapshot expires', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({
      guilds: [
        { id: 'a', name: 'A', owner: false, permissions: ADMIN },
        { id: 'b', name: 'B', owner: false, permissions: ADMIN },
      ],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    // Expired snapshot that predates the grant for guild B.
    const session = makeSession({
      fetchedAtMs: clock.now() - 20 * MINUTE,
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: false, permissions: ADMIN }] },
    });

    assert.deepStrictEqual(session.user.discordGuilds.map((g) => g.id), ['a'], 'snapshot starts without B');
    // The (expired) snapshot triggers a refresh, which reveals B is now manageable.
    assert.strictEqual(await access.canManageGuild(session, 'b'), true);
    assert.strictEqual(oauth.calls.guildFetches, 1);
    assert.ok(session.user.discordGuilds.some((g) => g.id === 'b'), 'session snapshot updated with B');
    assert.strictEqual(session.discordOAuth.guildPermissionsFetchedAt, clock.now());
  });

  suite.testAsync('OAuth invalidation requires re-authentication (401), never stale allow', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({ failWith: new UnauthorizedError('revoked') });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    const session = makeSession({
      fetchedAtMs: clock.now() - 20 * MINUTE, // expired -> refresh attempt fails
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }] },
    });

    await assert.rejects(access.canManageGuild(session, 'a'), (err) => err instanceof UnauthorizedError);
  });

  suite.testAsync('transient Discord outage fails closed with an external error, not allow', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({ failWith: new Error('Discord unreachable') });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });
    const access = new GuildAccessService({ guildGateway: makeGateway(), permissionService: perm, isDemo: false });

    const session = makeSession({
      fetchedAtMs: clock.now() - 20 * MINUTE,
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }] },
    });

    await assert.rejects(access.canManageGuild(session, 'a'), (err) => err instanceof Error);
  });

  suite.testAsync('access token refresh updates the server-side session credentials', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({
      guilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });

    // Token expired; refresh path must be taken and stored back into the session.
    const session = {
      user: { id: 'u', discordGuilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }] },
      discordOAuth: {
        accessToken: 'stale-token',
        refreshToken: 'refresh-tok',
        expiresAt: clock.now() - 5 * MINUTE,
        guildPermissionsFetchedAt: clock.now() - 20 * MINUTE,
      },
    };

    await perm.getCurrentGuildPermissions(session);
    assert.strictEqual(oauth.calls.refreshCalls, 1);
    assert.strictEqual(session.discordOAuth.accessToken, 'refreshed-token');
    assert.ok(session.discordOAuth.expiresAt > clock.now());
  });

  suite.testAsync('near-expiry access token with no refresh token still attempts the fetch', async () => {
    const clock = createFakeClock(Date.now());
    const oauth = makeOAuthClient({
      guilds: [{ id: 'a', name: 'A', owner: true, permissions: '0' }],
    });
    const perm = new GuildPermissionService({ oauthClient: oauth, clock, ttlSeconds: 600 });

    const session = {
      user: { id: 'u', discordGuilds: [] },
      discordOAuth: {
        accessToken: 'tok',
        refreshToken: null,
        expiresAt: clock.now() - 5 * MINUTE,
        guildPermissionsFetchedAt: clock.now() - 20 * MINUTE,
      },
    };

    const guilds = await perm.getCurrentGuildPermissions(session);
    assert.strictEqual(oauth.calls.guildFetches, 1);
    assert.strictEqual(guilds[0].id, 'a');
  });

  return suite.run();
}

module.exports = { runPermissionFreshnessTests };

if (require.main === module) {
  runPermissionFreshnessTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
