const fs = require('fs');
const os = require('os');
const path = require('path');
const { TestSuite, assert } = require('./helpers/harness');
const { SqliteSessionStore } = require('../src/dashboard/auth/sqliteSessionStore');

function storeSet(store, sid, data) {
  return new Promise((resolve, reject) => store.set(sid, data, (error) => (error ? reject(error) : resolve())));
}

function storeGet(store, sid) {
  return new Promise((resolve, reject) => store.get(sid, (error, data) => (error ? reject(error) : resolve(data))));
}

async function runSessionStoreTests() {
  const suite = new TestSuite('SQLite Session Store');

  suite.testAsync('keeps a session available after the store is reopened', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-session-test-'));
    const dbPath = path.join(tempDir, 'sessions.sqlite');

    try {
      const firstStore = new SqliteSessionStore({ path: dbPath });
      await storeSet(firstStore, 'sid-1', {
        cookie: { maxAge: 60_000 },
        user: { id: 'discord-user', username: 'Mochi User' },
        discordOAuth: { accessToken: 'server-only-token' },
      });
      firstStore.close();

      const reopenedStore = new SqliteSessionStore({ path: dbPath });
      const restored = await storeGet(reopenedStore, 'sid-1');
      assert.deepStrictEqual(restored.user, { id: 'discord-user', username: 'Mochi User' });
      assert.strictEqual(restored.discordOAuth.accessToken, 'server-only-token');
      reopenedStore.close();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  suite.testAsync('does not return expired sessions', async () => {
    const store = new SqliteSessionStore({ path: ':memory:', ttlMs: 1 });
    await storeSet(store, 'expired', { cookie: { maxAge: 0 }, user: { id: 'expired' } });
    assert.strictEqual(await storeGet(store, 'expired'), null);
    store.close();
  });

  return suite.run();
}

module.exports = { runSessionStoreTests };

if (require.main === module) {
  runSessionStoreTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
