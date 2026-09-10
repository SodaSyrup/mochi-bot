const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/database/createDatabase');
const { TestSuite, assert } = require('./helpers/harness');
const worker = require('../cloudflare/global-bans/src/index.js').default;

function createD1() {
  const db = createDatabase({ path: ':memory:' });
  db.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/global-bans/migrations/0001_initial.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/global-bans/migrations/0003_mutation_ownership.sql'), 'utf8'));
  const prepare = (sql) => ({
    bind(...args) {
      return {
        first: async () => db.prepare(sql).get(...args) || null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        run: async () => { const result = db.prepare(sql).run(...args); return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid || 0) } }; },
      };
    },
  });
  return {
    prepare,
    batch: async (statements) => db.transaction(() => statements.map((statement) => {
      const result = db.prepare(statement.sql).run(...statement.args);
      return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid || 0) } };
    }))(),
  };
}

async function runWorkerTests() {
  const suite = new TestSuite('Global Ban Worker');
  suite.test('serializes concurrent mutations with a version and mutation token', async () => {
    const DB = createD1();
    // Preserve the tiny D1 adapter's bound SQL for batch execution.
    const originalPrepare = DB.prepare;
    // Delegate reads and standalone statements to the real adapter while keeping
    // statement objects inspectable by batch().
    DB.prepare = (sql) => ({
      sql,
      args: [],
      bind(...args) { this.args = args; return this; },
      first: async function () { return (await originalPrepare(sql).bind(...this.args).first()); },
      all: async function () { return (await originalPrepare(sql).bind(...this.args).all()); },
      run: async function () { return (await originalPrepare(sql).bind(...this.args).run()); },
    });
    const env = { DB, ADMIN_TOKEN: 'admin' };
    const headers = (key) => ({ authorization: 'Bearer admin', 'content-type': 'application/json', 'idempotency-key': key, 'x-operator-id': 'tester' });
    const createResponse = await worker.fetch(new Request('https://worker.test/v1/admin/bans', { method: 'POST', headers: headers('create-1'), body: JSON.stringify({ userId: '123456789', reasonCode: 'raid', publicReason: 'Confirmed raid' }) }), env);
    assert.strictEqual(createResponse.status, 200);
    const [first, second] = await Promise.all(['activate-1', 'activate-2'].map((key) => worker.fetch(new Request('https://worker.test/v1/admin/bans/123456789/activate', { method: 'POST', headers: headers(key), body: JSON.stringify({ expectedVersion: 1 }) }), env)));
    assert.deepStrictEqual([first.status, second.status].sort(), [200, 409]);
    const events = (await DB.prepare('SELECT action FROM global_ban_events ORDER BY event_id').all()).results;
    assert.deepStrictEqual(events.map((event) => event.action), ['proposed', 'activated']);
  });
  suite.test('replays a completed mutation when the response is retried', async () => {
    const DB = createD1();
    const originalPrepare = DB.prepare;
    DB.prepare = (sql) => ({ sql, args: [], bind(...args) { this.args = args; return this; }, first: async function () { return originalPrepare(sql).bind(...this.args).first(); }, all: async function () { return originalPrepare(sql).bind(...this.args).all(); }, run: async function () { return originalPrepare(sql).bind(...this.args).run(); } });
    const env = { DB, ADMIN_TOKEN: 'admin' };
    const headers = { authorization: 'Bearer admin', 'content-type': 'application/json', 'idempotency-key': 'same-create', 'x-operator-id': 'tester' };
    const request = () => worker.fetch(new Request('https://worker.test/v1/admin/bans', { method: 'POST', headers, body: JSON.stringify({ userId: '987654321', reasonCode: 'raid', publicReason: 'Confirmed raid' }) }), env);
    const first = await request();
    const replay = await request();
    assert.strictEqual(first.status, 200);
    assert.strictEqual(replay.status, 200);
    assert.strictEqual((await replay.json()).replayed, true);
    assert.strictEqual((await DB.prepare('SELECT COUNT(*) AS count FROM global_ban_events').first()).count, 1);
  });
  return suite.run();
}

runWorkerTests();
