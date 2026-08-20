const { TestSuite, assert } = require('./helpers/harness');
const { GuildSerialQueue } = require('../src/features/invites/application/guildSerialQueue');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSerialQueueTests() {
  const suite = new TestSuite('Guild Serial Queue');

  suite.test('tasks for the same guild run sequentially', async () => {
    const queue = new GuildSerialQueue();
    const order = [];
    const run = (guildId, name, delay) =>
      queue.run(guildId, async () => {
        order.push(`${name}:start`);
        await sleep(delay);
        order.push(`${name}:end`);
        return name;
      });

    await Promise.all([
      run('guildA', 'a1', 20),
      run('guildA', 'a2', 5),
      run('guildA', 'a3', 5),
    ]);

    // a1 must fully finish before a2 starts (same guild).
    assert.ok(order.indexOf('a1:end') < order.indexOf('a2:start'), `order was ${order.join(', ')}`);
    assert.ok(order.indexOf('a2:end') < order.indexOf('a3:start'), `order was ${order.join(', ')}`);
  });

  suite.test('tasks for different guilds run concurrently', async () => {
    const queue = new GuildSerialQueue();
    let concurrent = 0;
    let maxConcurrent = 0;

    const run = (guildId) =>
      queue.run(guildId, async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(20);
        concurrent -= 1;
      });

    await Promise.all([run('guildA'), run('guildB'), run('guildC'), run('guildD')]);
    assert.ok(maxConcurrent >= 2, `expected concurrency, got ${maxConcurrent}`);
  });

  suite.test('failed work does not poison the queue', async () => {
    const queue = new GuildSerialQueue();
    const results = [];
    const failing = queue.run('g', async () => { throw new Error('boom'); });
    await failing.catch(() => {});
    const ok = await queue.run('g', async () => 'recovered');
    assert.strictEqual(ok, 'recovered');
    results.push(ok);
  });

  suite.test('completed entries are cleaned up', async () => {
    const queue = new GuildSerialQueue();
    await queue.run('g', async () => {});
    await sleep(0);
    assert.strictEqual(queue.pendingCount, 0);
  });

  return suite.run();
}

module.exports = { runSerialQueueTests };

if (require.main === module) {
  runSerialQueueTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
