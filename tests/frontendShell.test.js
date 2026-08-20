const { TestSuite, assert } = require('./helpers/harness');
const { NAV_GROUPS, findNavItem } = require('../src/dashboard/public/js/layout');
const { resolveBotStatus } = require('../src/dashboard/public/js/shared');

async function runFrontendShellTests() {
  const suite = new TestSuite('Frontend Shell (layout + status)');

  suite.test('navigation groups and routes match the planned structure', () => {
    assert.deepStrictEqual(NAV_GROUPS.map((g) => g.label), ['Invites', 'Moderation', 'System']);

    const routes = {};
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        routes[item.page] = item.href;
      }
    }
    assert.deepStrictEqual(routes, {
      overview: '/',
      analytics: '/analytics',
      leaderboard: '/leaderboard',
      codes: '/codes',
      safety: '/safety',
      simulator: '/simulator',
      settings: '/settings',
    });
  });

  suite.test('findNavItem resolves the active page from body data-page', () => {
    assert.strictEqual(findNavItem('overview').label, 'Overview');
    assert.strictEqual(findNavItem('analytics').href, '/analytics');
    assert.strictEqual(findNavItem('safety').label, 'Safety');
    assert.strictEqual(findNavItem('codes').label, 'Invite links');
    assert.strictEqual(findNavItem('nope'), undefined);
  });

  suite.test('every nav item carries a Font Awesome icon for the sidebar', () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        assert.ok(item.icon.startsWith('fa-'), `${item.page} must define an icon class`);
      }
    }
  });

  suite.test('resolveBotStatus maps connected/demo/disconnected semantics', () => {
    assert.deepStrictEqual(resolveBotStatus({ connected: true, tag: 'Mochi#1234' }), {
      status: 'connected',
      text: 'Connected · Mochi#1234',
    });
    assert.deepStrictEqual(resolveBotStatus({ demoMode: true }), {
      status: 'demo',
      text: 'Demo mode',
    });
    assert.deepStrictEqual(resolveBotStatus({}), {
      status: 'disconnected',
      text: 'Disconnected',
    });
  });

  suite.test('status resolver never emits presentation colors or drama', () => {
    const outputs = [resolveBotStatus({ connected: true, tag: 'Mochi#1' }), resolveBotStatus({ demoMode: true }), resolveBotStatus({})];
    for (const out of outputs) {
      assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(out.text), 'no hex colors in status text');
      assert.ok(!/LIVE|ENGINE|ARMED|GATEWAY/i.test(out.text), 'no marketing status wording');
    }
  });

  return suite.run();
}

module.exports = { runFrontendShellTests };

if (require.main === module) {
  runFrontendShellTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
