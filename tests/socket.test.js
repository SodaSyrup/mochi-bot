const { TestSuite, assert } = require('./helpers/harness');
const { startTestServer, demoLogin } = require('./helpers/server');
const { io: createSocketClient } = require('socket.io-client');
const { InviteEvents } = require('../src/app/eventBus');
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

  suite.testAsync('guild event reaches only the authorized room, never globally', async () => {
    // Listener for events not in any room.
    let receivedByAnon = null;
    anon.on('memberJoin', (d) => { receivedByAnon = d; });

    // Authorized client joined DEMO_GUILD_ID. Publish for the demo guild.
    const p1 = waitForEvent(authed, 'memberJoin');
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, {
      guildId: DEMO_GUILD_ID,
      member: { id: 'x', username: 'X', avatar: null },
      attribution: { type: 'INVITE', inviterId: 'u1', inviteCode: 'c' },
      inviter: null,
      isFake: false,
      inviterStats: null,
      occurredAt: new Date().toISOString(),
    });
    const received = await p1;
    assert.strictEqual(received.member.id, 'x');
    assert.strictEqual(received.guildId, DEMO_GUILD_ID);

    // The unauthenticated socket is not in the room -> no global delivery.
    await sleep(150);
    assert.strictEqual(receivedByAnon, null);

    // Publish for a DIFFERENT guild; the authorized demo-guild client must not get it.
    let receivedWrongGuild = null;
    authed.on('memberJoin', (d) => { receivedWrongGuild = d; });
    ctx.services.eventBus.emit(InviteEvents.MemberLeft, {
      guildId: 'some-other-guild',
      member: { id: 'y', username: 'Y' },
      attribution: { type: 'UNKNOWN', inviterId: null, inviteCode: null },
      occurredAt: new Date().toISOString(),
    });
    await sleep(150);
    assert.strictEqual(receivedWrongGuild, null);
  });

  suite.testAsync('leaveGuild removes the client from the room', async () => {
    const ack = await emitWithAck(authed, 'leaveGuild', DEMO_GUILD_ID);
    assert.strictEqual(ack.success, true);

    let received = null;
    authed.on('memberJoin', (d) => { received = d; });
    ctx.services.eventBus.emit(InviteEvents.MemberJoined, {
      guildId: DEMO_GUILD_ID,
      member: { id: 'z', username: 'Z' },
      attribution: { type: 'UNKNOWN', inviterId: null, inviteCode: null },
      occurredAt: new Date().toISOString(),
    });
    await sleep(150);
    assert.strictEqual(received, null);
  });

  anon?.close();
  authed?.close();
  await ctx?.server?.close();

  return suite.run();
}

module.exports = { runSocketTests };

if (require.main === module) {
  runSocketTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
