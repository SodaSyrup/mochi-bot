const { TestSuite, assert } = require('./helpers/harness');
const { startTestServer, demoLogin } = require('./helpers/server');
const { io: createSocketClient } = require('socket.io-client');
const { InviteEvents, SafetyEvents } = require('../src/app/eventBus');
const { DEMO_GUILD_ID } = require('../src/demo/fixtures');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url, cookie, { transports = ['polling'] } = {}) {
  const socket = createSocketClient(url, {
    transports,
    forceNew: true,
    reconnection: false,
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent(socket, event, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Count every delivery of `eventName` on a socket. The listener MUST be
 * attached before the publisher emits for the count to prove "exactly once"
 * — attaching after the event arrived can only prove "no later duplicate".
 */
function countSocketEvents(socket, eventName) {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  socket.on(eventName, listener);
  return {
    get count() {
      return count;
    },
    cleanup() {
      socket.off(eventName, listener);
    },
  };
}

function buildCanonicalJoin(guildId, overrides = {}) {
  return {
    guildId,
    member: { id: 'member-1', username: 'Alice', avatar: 'avatar-url' },
    attribution: { type: 'INVITE', inviterId: 'inviter-1', inviteCode: 'abc' },
    inviter: { id: 'inviter-1', username: 'Inviter', avatar: null },
    isFake: false,
    inviterStats: { regular: 4, bonus: 1, leaves: 1, fake: 0, total: 4 },
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildCanonicalLeave(guildId, overrides = {}) {
  return {
    guildId,
    member: { id: 'member-2', username: 'Bob', avatar: null },
    attribution: { type: 'INVITE', inviterId: 'inviter-1', inviteCode: 'abc' },
    inviter: { id: 'inviter-1', username: 'Inviter', avatar: null },
    inviterStats: { regular: 4, bonus: 1, leaves: 2, fake: 0, total: 3 },
    occurredAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

async function runSocketTests() {
  const suite = new TestSuite('Socket.IO Authorization & Isolation');

  let ctx;
  let url;
  let cookie;
  let authed;
  let anon;

  suite.testAsync('server starts and demo login provides a session', async () => {
    ctx = await startTestServer();
    url = ctx.baseUrl;
    const auth = await demoLogin(url);
    cookie = auth.headers.Cookie;
    assert.ok(cookie);
  });

  suite.testAsync('unauthenticated socket cannot join a guild room', async () => {
    anon = await connect(url);
    const response = await emitWithAck(anon, 'joinGuild', DEMO_GUILD_ID);
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.error, 'UNAUTHORIZED');
  });

  suite.testAsync('authenticated socket can join the demo guild room', async () => {
    authed = await connect(url, cookie);
    const response = await emitWithAck(authed, 'joinGuild', DEMO_GUILD_ID);
    assert.strictEqual(response.success, true);
  });

  suite.testAsync('authenticated socket is denied another guild room', async () => {
    const response = await emitWithAck(authed, 'joinGuild', 'not-my-guild');
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.error, 'FORBIDDEN');
  });

  suite.testAsync('memberJoin transport exposes member.username, never data.user', async () => {
    const p = waitForEvent(authed, 'memberJoin');
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, buildCanonicalJoin(DEMO_GUILD_ID));
    const received = await p;
    assert.ok(!('user' in received), 'transport must not expose a top-level user alias');
    assert.strictEqual(received.member.username, 'Alice');
    assert.strictEqual(received.member.id, 'member-1');
    assert.strictEqual(received.member.avatar, 'avatar-url');
    assert.strictEqual(received.attribution.inviteCode, 'abc');
    assert.strictEqual(received.attribution.inviterId, 'inviter-1');
    assert.strictEqual(received.inviter.username, 'Inviter');
    assert.strictEqual(received.inviterStats.total, 4);
  });

  suite.testAsync('memberLeave transport matches the same member naming contract', async () => {
    const p = waitForEvent(authed, 'memberLeave');
    ctx.services.eventBus.emit(InviteEvents.MemberLeft, buildCanonicalLeave(DEMO_GUILD_ID));
    const received = await p;
    assert.ok(!('user' in received));
    assert.strictEqual(received.member.username, 'Bob');
    assert.strictEqual(received.attribution.inviteCode, 'abc');
  });

  suite.testAsync('inviteCreated transport exposes the invite code where the dashboard expects it', async () => {
    const p = waitForEvent(authed, 'inviteCreated');
    ctx.services.eventBus.emit(InviteEvents.InviteCreated, {
      guildId: DEMO_GUILD_ID,
      invite: { code: 'newcode123', url: 'https://discord.gg/newcode123', uses: 0, maxUses: 0, maxAge: 0, temporary: false, inviter: { id: 'u', username: 'U' }, createdAt: '2026-01-01T00:00:00.000Z', label: 'Promo' },
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    const received = await p;
    assert.strictEqual(received.invite.code, 'newcode123');
    assert.strictEqual(received.invite.label, 'Promo');
  });

  suite.testAsync('autoModExecution transport is a plain JSON-safe payload', async () => {
    const p = waitForEvent(authed, 'autoModExecution');
    ctx.services.eventBus.emit(SafetyEvents.AutoModExecution, {
      guildId: DEMO_GUILD_ID,
      guildName: 'Demo',
      ruleId: 'r1',
      ruleName: 'Scam Filter',
      ruleTriggerType: 1,
      action: { type: 1, metadata: {} },
      userId: 'u9',
      user: { id: 'u9', username: 'Spammer', avatar: null },
      channelId: 'c1',
      channelName: 'general',
      content: 'bad',
      matchedKeyword: 'x',
      executedAt: '2026-01-01T00:00:00.000Z',
    });
    const received = await p;
    assert.strictEqual(received.ruleName, 'Scam Filter');
    assert.strictEqual(received.action.type, 1);
    assert.strictEqual(received.guildId, DEMO_GUILD_ID);
  });

  suite.testAsync('guild events reach only the authorized room, never globally', async () => {
    // Listener for events not in any room.
    let receivedByAnon = null;
    anon.on('memberJoin', (d) => { receivedByAnon = d; });

    // Authorized client joined DEMO_GUILD_ID. Publish for the demo guild.
    const p1 = waitForEvent(authed, 'memberJoin');
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, buildCanonicalJoin(DEMO_GUILD_ID));
    const received = await p1;
    assert.strictEqual(received.member.id, 'member-1');
    assert.strictEqual(received.guildId, DEMO_GUILD_ID);

    // The unauthenticated socket is not in the room -> no global delivery.
    await sleep(150);
    assert.strictEqual(receivedByAnon, null);
  });

  suite.testAsync('publishing MemberLeft is only caught by a memberLeave listener', async () => {
    // Listen for the event actually emitted (memberLeave), while also proving
    // the memberJoin listener stays quiet — the real isolation assertion.
    let joinEvents = [];
    let leaveEvents = [];
    authed.on('memberJoin', (d) => joinEvents.push(d));
    authed.on('memberLeave', (d) => leaveEvents.push(d));

    ctx.services.eventBus.emit(InviteEvents.MemberLeft, buildCanonicalLeave('some-other-guild'));

    await sleep(150);
    assert.strictEqual(joinEvents.length, 0, 'memberJoin listener must not fire for a MemberLeft event');
    assert.strictEqual(leaveEvents.length, 0, 'leave for another guild must not reach the demo-guild client');
  });

  suite.testAsync('leaveGuild removes the client from the room', async () => {
    const ack = await emitWithAck(authed, 'leaveGuild', DEMO_GUILD_ID);
    assert.strictEqual(ack.success, true);

    let received = null;
    authed.on('memberJoin', (d) => { received = d; });
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, buildCanonicalJoin(DEMO_GUILD_ID, { member: { id: 'z', username: 'Z', avatar: null } }));
    await sleep(150);
    assert.strictEqual(received, null);
  });

  suite.testAsync('memberJoin is not delivered twice for a single application event', async () => {
    const ack = await emitWithAck(authed, 'joinGuild', DEMO_GUILD_ID);
    assert.strictEqual(ack.success, true);

    let count = 0;
    authed.on('memberJoin', () => { count += 1; });
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, buildCanonicalJoin(DEMO_GUILD_ID));
    await sleep(150);
    assert.strictEqual(count, 1, 'exactly one delivery expected');
  });

  suite.testAsync('one canonical autoModRuleUpdated event yields exactly one delivery', async () => {
    // Mirrors the dedup model: a single logical rule change (whether from the
    // service path or the Discord echo) publishes one canonical event, which
    // must reach the room exactly once.
    const ack = await emitWithAck(authed, 'joinGuild', DEMO_GUILD_ID);
    assert.strictEqual(ack.success, true);

    let count = 0;
    authed.on('autoModRuleUpdated', () => { count += 1; });
    ctx.services.eventBus.emit(SafetyEvents.AutoModRuleUpdated, {
      guildId: DEMO_GUILD_ID,
      action: 'update',
      ruleId: 'r1',
      name: 'Spam Filter',
      enabled: true,
    });
    await sleep(150);
    assert.strictEqual(count, 1, 'exactly one rule-update delivery expected');
  });

  anon?.close();
  authed?.close();
  await ctx?.server?.close();

  return suite.run();
}

/**
 * True end-to-end guild isolation with two authorized guilds (development
 * bypass grants access to every bot guild). Guild B events must never reach a
 * guild A client, and guild B must receive exactly one delivery.
 */
async function runSocketIsolationTests() {
  const suite = new TestSuite('Socket.IO Guild Isolation');

  let ctx;
  let url;
  let cookie;
  let socketA;
  let socketB;

  suite.testAsync('start a development server with two bot guilds', async () => {
    const mockClient = {
      user: { username: 'MochiMock', tag: 'MochiMock#0000' },
      guilds: {
        cache: new Map([
          ['guildA', { id: 'guildA', name: 'Guild A', memberCount: 10, ownerId: 'o1' }],
          ['guildB', { id: 'guildB', name: 'Guild B', memberCount: 20, ownerId: 'o2' }],
        ]),
      },
      isReady: () => true,
    };
    ctx = await startTestServer({
      mode: 'development',
      seed: false,
      client: mockClient,
      env: { CLIENT_ID: '', CLIENT_SECRET: '', DEV_AUTH_BYPASS: 'true' },
    });
    url = ctx.baseUrl;

    const login = await fetch(`${url}/auth/login`, { redirect: 'manual' });
    cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'dev bypass login must set a session cookie');

    socketA = await connect(url, cookie);
    socketB = await connect(url, cookie);
    assert.strictEqual((await emitWithAck(socketA, 'joinGuild', 'guildA')).success, true);
    assert.strictEqual((await emitWithAck(socketB, 'joinGuild', 'guildB')).success, true);
  });

  suite.testAsync('member event for guild B: A receives nothing, B receives exactly one', async () => {
    // Both counters are attached BEFORE publication: this proves the logical
    // event is delivered exactly once, not merely that no later duplicate
    // arrives after a listener was installed post-hoc.
    const aCount = countSocketEvents(socketA, 'memberJoin');
    const bCount = countSocketEvents(socketB, 'memberJoin');

    ctx.services.eventBus.emit(InviteEvents.MemberJoined, buildCanonicalJoin('guildB'));
    await sleep(150);

    assert.strictEqual(aCount.count, 0, 'guild A client must receive zero member events');
    assert.strictEqual(bCount.count, 1, 'guild B client must receive exactly one member event');
    bCount.cleanup();
    aCount.cleanup();
  });

  suite.testAsync('leave event for guild B uses the same member contract and stays isolated', async () => {
    const aCount = countSocketEvents(socketA, 'memberLeave');
    const bCount = countSocketEvents(socketB, 'memberLeave');

    ctx.services.eventBus.emit(InviteEvents.MemberLeft, buildCanonicalLeave('guildB'));
    await sleep(150);

    assert.strictEqual(aCount.count, 0, 'guild A client must receive zero leave events');
    assert.strictEqual(bCount.count, 1, 'guild B client must receive exactly one leave event');
    bCount.cleanup();
    aCount.cleanup();
  });

  suite.testAsync('invite event for guild B is isolated and delivered exactly once', async () => {
    const aCount = countSocketEvents(socketA, 'inviteCreated');
    const bCount = countSocketEvents(socketB, 'inviteCreated');

    ctx.services.eventBus.emit(InviteEvents.InviteCreated, {
      guildId: 'guildB',
      invite: { code: 'iso-abc', url: 'https://discord.gg/iso-abc', uses: 0, maxUses: 0, maxAge: 0, temporary: false, inviter: { id: 'u1', username: 'U' }, createdAt: '2026-01-01T00:00:00.000Z', label: null },
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    await sleep(150);

    assert.strictEqual(aCount.count, 0, 'guild A client must receive zero invite events');
    assert.strictEqual(bCount.count, 1, 'guild B client must receive exactly one invite event');
    bCount.cleanup();
    aCount.cleanup();
  });

  suite.testAsync('autoMod execution for guild B is isolated and delivered exactly once', async () => {
    const aCount = countSocketEvents(socketA, 'autoModExecution');
    const bCount = countSocketEvents(socketB, 'autoModExecution');

    ctx.services.eventBus.emit(SafetyEvents.AutoModExecution, {
      guildId: 'guildB',
      guildName: 'Guild B',
      ruleId: 'r1',
      ruleName: 'Spam Filter',
      ruleTriggerType: 1,
      action: { type: 1, metadata: {} },
      userId: 'u9',
      user: { id: 'u9', username: 'Spammer', avatar: null },
      channelId: 'c1',
      channelName: 'general',
      content: 'bad',
      matchedKeyword: 'x',
      executedAt: '2026-01-01T00:00:00.000Z',
    });
    await sleep(150);

    assert.strictEqual(aCount.count, 0, 'guild A client must receive zero autoMod executions');
    assert.strictEqual(bCount.count, 1, 'guild B client must receive exactly one autoMod execution');
    bCount.cleanup();
    aCount.cleanup();
  });

  suite.testAsync('autoMod rule update for guild B is isolated and delivered exactly once', async () => {
    const aCount = countSocketEvents(socketA, 'autoModRuleUpdated');
    const bCount = countSocketEvents(socketB, 'autoModRuleUpdated');

    ctx.services.eventBus.emit(SafetyEvents.AutoModRuleUpdated, {
      guildId: 'guildB',
      action: 'update',
      ruleId: 'r1',
      name: 'Spam Filter',
      enabled: true,
    });
    await sleep(150);

    assert.strictEqual(aCount.count, 0, 'guild A client must receive zero rule updates');
    assert.strictEqual(bCount.count, 1, 'guild B client must receive exactly one rule update');
    bCount.cleanup();
    aCount.cleanup();
  });

  socketA?.close();
  socketB?.close();
  await ctx?.server?.close();

  return suite.run();
}

/**
 * Proves that when GuildPermissionService refreshes OAuth credentials or the
 * guild permission snapshot during Socket.IO authorization, the refreshed
 * session is persisted to the session store. Uses the real socket transport
 * (polling) so the express-session socket handshake path is exercised.
 */
async function runSocketSessionPersistenceTests() {
  const suite = new TestSuite('Socket.IO Session Persistence');
  const express = require('express');
  const http = require('http');
  const { Server: SocketIOServer } = require('socket.io');
  const sessionMiddleware = require('express-session');
  const { SocketGateway } = require('../src/dashboard/realtime/socketGateway');
  const { GuildPermissionService } = require('../src/dashboard/auth/guildPermissionService');
  const { GuildAccessService } = require('../src/dashboard/auth/guildAccessService');
  const { createEventBus } = require('../src/app/eventBus');
  const { silentLogger } = require('./helpers/server');

  let server;
  let io;
  let baseUrl;

  suite.testAsync('refreshed OAuth material during socket join is written back to the session store', async () => {
    const store = new sessionMiddleware.MemoryStore();
    const mid = sessionMiddleware({
      name: 'sid',
      secret: 'socket-session-test-secret',
      store,
      resave: false,
      saveUninitialized: false,
    });

    const app = express();
    app.use(mid);
    // Seed a session whose access token and permission snapshot are both stale.
    app.get('/seed', (req, res) => {
      req.session.user = { id: 'u', discordGuilds: [] };
      req.session.discordOAuth = {
        accessToken: 'stale-token',
        refreshToken: 'refresh-tok',
        expiresAt: Date.now() - 5 * 60 * 1000,
        guildPermissionsFetchedAt: Date.now() - 999999,
      };
      res.send('ok');
    });

    server = http.createServer(app);
    io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });
    io.engine.use(mid);

    const oauthClient = {
      async refreshAccessToken() {
        return { accessToken: 'refreshed-token', refreshToken: 'refresh-tok', expiresIn: 3600 };
      },
      async fetchGuilds() {
        return [{ id: 'g', name: 'G', owner: true, permissions: '0' }];
      },
    };
    const permission = new GuildPermissionService({ oauthClient, ttlSeconds: 600 });
    const guildAccess = new GuildAccessService({
      guildGateway: { async listGuilds() { return [{ id: 'g', name: 'G', memberCount: 1 }]; } },
      permissionService: permission,
      isDemo: false,
    });
    new SocketGateway({ io, eventBus: createEventBus(), guildAccess, logger: silentLogger });

    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;

    const seed = await fetch(`${baseUrl}/seed`);
    const setCookie = seed.headers.get('set-cookie');
    assert.ok(setCookie, 'seed route must set a session cookie');
    const cookie = setCookie.split(';')[0];
    const sid = decodeURIComponent(cookie).replace(/^sid=s:/, '').split('.')[0];

    const socket = await connect(baseUrl, cookie);
    const ack = await emitWithAck(socket, 'joinGuild', 'g');
    assert.strictEqual(ack.success, true);

    // Read the session back from the STORE (not the socket's in-memory object)
    // — this is exactly what the next request would load.
    const persisted = await new Promise((resolve, reject) => {
      store.get(sid, (err, s) => (err ? reject(err) : resolve(s)));
    });
    assert.ok(persisted, 'session must exist in the store after joinGuild');
    assert.strictEqual(persisted.discordOAuth.accessToken, 'refreshed-token', 'refreshed access token must be persisted');
    assert.ok(persisted.discordOAuth.guildPermissionsFetchedAt > 0, 'refreshed permission timestamp must be persisted');
    assert.ok(Array.isArray(persisted.user.discordGuilds), 'refreshed guild snapshot must be persisted');

    socket.close();
  });

  suite.testAsync('WebSocket transport persists refreshed OAuth material to the session store', async () => {
    // The one true WebSocket integration test: exercises the socket.io
    // websocket upgrade path AND proves the OAuth permission refresh performed
    // during joinGuild authorization is written back to the backing store.
    const store = new sessionMiddleware.MemoryStore();
    const mid = sessionMiddleware({
      name: 'sid',
      secret: 'socket-ws-test-secret',
      store,
      resave: false,
      saveUninitialized: false,
    });
    const app = express();
    app.use(mid);
    app.get('/seed', (req, res) => {
      req.session.user = { id: 'u', discordGuilds: [] };
      req.session.discordOAuth = {
        accessToken: 'stale-token',
        refreshToken: 'ws-refresh-tok',
        expiresAt: Date.now() - 5 * 60 * 1000,
        guildPermissionsFetchedAt: Date.now() - 999999,
      };
      res.send('ok');
    });

    server = http.createServer(app);
    io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });
    io.engine.use(mid);

    const oauthClient = {
      async refreshAccessToken() {
        return { accessToken: 'ws-refreshed-token', refreshToken: 'ws-refresh-tok-2', expiresIn: 3600 };
      },
      async fetchGuilds() {
        return [{ id: 'g', name: 'G', owner: true, permissions: '0' }];
      },
    };
    const permission = new GuildPermissionService({ oauthClient, ttlSeconds: 600 });
    const guildAccess = new GuildAccessService({
      guildGateway: { async listGuilds() { return [{ id: 'g', name: 'G', memberCount: 1 }]; } },
      permissionService: permission,
      isDemo: false,
    });
    new SocketGateway({ io, eventBus: createEventBus(), guildAccess, logger: silentLogger });

    // Count store writes so we can prove the socket path called save() rather
    // than only asserting the in-memory session object changed.
    let saveCalls = 0;
    const origSet = store.set.bind(store);
    store.set = (sid, session, cb) => {
      saveCalls += 1;
      return origSet(sid, session, cb);
    };

    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;

    const seed = await fetch(`${baseUrl}/seed`);
    const cookie = seed.headers.get('set-cookie').split(';')[0];
    const sid = decodeURIComponent(cookie).replace(/^sid=s:/, '').split('.')[0];

    const socket = await connect(baseUrl, cookie, { transports: ['websocket'] });
    // Reset so only writes triggered by the socket join count.
    saveCalls = 0;
    const ack = await emitWithAck(socket, 'joinGuild', 'g');
    assert.strictEqual(ack.success, true, 'authorization must succeed over the websocket transport');

    // Read the session back from the STORE — what the next request would load.
    const persisted = await new Promise((resolve, reject) => {
      store.get(sid, (err, s) => (err ? reject(err) : resolve(s)));
    });
    assert.ok(persisted, 'backing session must exist after joinGuild over websocket');
    assert.strictEqual(persisted.discordOAuth.accessToken, 'ws-refreshed-token', 'refreshed access token must be persisted');
    assert.strictEqual(persisted.discordOAuth.refreshToken, 'ws-refresh-tok-2', 'refreshed refresh token must be persisted');
    assert.ok(persisted.discordOAuth.expiresAt > Date.now(), 'refreshed expiry must be persisted');
    assert.ok(persisted.discordOAuth.guildPermissionsFetchedAt > 0, 'refreshed permission timestamp must be persisted');
    assert.ok(Array.isArray(persisted.user.discordGuilds), 'refreshed guild snapshot must be persisted');
    assert.strictEqual(persisted.user.discordGuilds[0].id, 'g', 'guild permission snapshot must be persisted');
    assert.ok(saveCalls >= 1, 'the refreshed session must be saved back to the store by the socket path');

    socket.close();
  });

  suite.testAsync('joinGuild still works when the session has no save() (plain object)', async () => {
    // Defensive: a session-like object without express-session's save() must
    // not break the join path.
    const store = new sessionMiddleware.MemoryStore();
    const mid = sessionMiddleware({
      name: 'sid',
      secret: 'socket-session-test-secret-2',
      store,
      resave: false,
      saveUninitialized: false,
    });
    const app = express();
    app.use(mid);
    app.get('/seed', (req, res) => {
      req.session.user = { id: 'u', discordGuilds: [] };
      res.send('ok');
    });
    server = http.createServer(app);
    io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });
    io.engine.use(mid);

    new SocketGateway({
      io,
      eventBus: createEventBus(),
      // Simulate a guildAccess that replaces the session with a plain object.
      guildAccess: {
        async canViewGuild(session, guildId) {
          Object.assign(session, { user: { id: 'u', isDemo: true }, save: undefined });
          return guildId === 'g';
        },
      },
      logger: silentLogger,
    });

    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
    const seed = await fetch(`${baseUrl}/seed`);
    const cookie = seed.headers.get('set-cookie').split(';')[0];

    const socket = await connect(baseUrl, cookie);
    const ack = await emitWithAck(socket, 'joinGuild', 'g');
    assert.strictEqual(ack.success, true);
    socket.close();
  });

  io?.close();
  server?.close();

  return suite.run();
}

module.exports = { runSocketTests, runSocketIsolationTests, runSocketSessionPersistenceTests };

if (require.main === module) {
  Promise.all([runSocketTests(), runSocketIsolationTests(), runSocketSessionPersistenceTests()]).then((results) => {
    const failed = results.reduce((a, b) => a + b, 0);
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
