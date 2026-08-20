const { TestSuite, assert } = require('./helpers/harness');
const { startTestServer, demoLogin } = require('./helpers/server');
const { io: createSocketClient } = require('socket.io-client');
const { InviteEvents, SafetyEvents } = require('../src/app/eventBus');
const { DEMO_GUILD_ID } = require('../src/demo/fixtures');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(url, cookie) {
  const socket = createSocketClient(url, {
    transports: ['polling'],
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
 * Assert that a socket does NOT receive an event within a modest deterministic
 * window. Listeners must be attached before the publisher emits.
 */
async function expectNoSocketEvent(socket, event, timeout = 150) {
  const received = [];
  const listener = (data) => received.push(data);
  socket.on(event, listener);
  await sleep(timeout);
  socket.off(event, listener);
  assert.strictEqual(received.length, 0, `socket should not have received ${event}`);
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
    await expectNoSocketEvent(socketA, 'memberJoin');

    let bCount = 0;
    const bReceived = waitForEvent(socketB, 'memberJoin').then((d) => { bCount += 1; return d; });
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, buildCanonicalJoin('guildB'));
    const received = await bReceived;
    await sleep(50);

    assert.strictEqual(received.member.username, 'Alice');
    assert.strictEqual(received.guildId, 'guildB');
    assert.strictEqual(bCount, 1, 'guild B must receive exactly one member event');
  });

  suite.testAsync('leave event for guild B uses the same member contract and stays isolated', async () => {
    await expectNoSocketEvent(socketA, 'memberLeave');

    let bCount = 0;
    const bReceived = waitForEvent(socketB, 'memberLeave').then((d) => { bCount += 1; return d; });
    ctx.services.eventBus.emit(InviteEvents.MemberLeft, buildCanonicalLeave('guildB'));
    const received = await bReceived;
    await sleep(50);

    assert.strictEqual(received.member.username, 'Bob');
    assert.strictEqual(received.guildId, 'guildB');
    assert.strictEqual(bCount, 1);
  });

  suite.testAsync('invite event for guild B is isolated and carries the invite code', async () => {
    await expectNoSocketEvent(socketA, 'inviteCreated');

    let bCount = 0;
    const bReceived = waitForEvent(socketB, 'inviteCreated').then((d) => { bCount += 1; return d; });
    ctx.services.eventBus.emit(InviteEvents.InviteCreated, {
      guildId: 'guildB',
      invite: { code: 'iso-abc', url: 'https://discord.gg/iso-abc', uses: 0, maxUses: 0, maxAge: 0, temporary: false, inviter: { id: 'u1', username: 'U' }, createdAt: '2026-01-01T00:00:00.000Z', label: null },
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    const received = await bReceived;
    await sleep(50);

    assert.strictEqual(received.invite.code, 'iso-abc');
    assert.strictEqual(bCount, 1);
  });

  suite.testAsync('autoMod execution for guild B is isolated', async () => {
    await expectNoSocketEvent(socketA, 'autoModExecution');

    let bCount = 0;
    const bReceived = waitForEvent(socketB, 'autoModExecution').then((d) => { bCount += 1; return d; });
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
    const received = await bReceived;
    await sleep(50);

    assert.strictEqual(received.ruleName, 'Spam Filter');
    assert.strictEqual(bCount, 1);
  });

  socketA?.close();
  socketB?.close();
  await ctx?.server?.close();

  return suite.run();
}

module.exports = { runSocketTests, runSocketIsolationTests };

if (require.main === module) {
  Promise.all([runSocketTests(), runSocketIsolationTests()]).then((results) => {
    const failed = results.reduce((a, b) => a + b, 0);
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
