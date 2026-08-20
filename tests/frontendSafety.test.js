const { TestSuite, assert } = require('./helpers/harness');
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../src/dashboard/public/js/escapeHtml');

async function runFrontendSafetyTests() {
  const suite = new TestSuite('Frontend Injection Safety');

  suite.test('escapeHtml neutralizes HTML special characters', () => {
    assert.strictEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.strictEqual(escapeHtml('a&b'), 'a&amp;b');
    assert.strictEqual(escapeHtml('"quoted"'), '&quot;quoted&quot;');
    assert.strictEqual(escapeHtml("'it's'"), '&#39;it&#39;s&#39;');
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
  });

  suite.test('toast rendering never assigns external message HTML via innerHTML', () => {
    const sharedSrc = fs.readFileSync(path.join(__dirname, '../src/dashboard/public/js/shared.js'), 'utf8');
    // showToast must build DOM nodes with textContent, not innerHTML template interpolation.
    assert.ok(!/toast\.innerHTML\s*=/.test(sharedSrc), 'toast.innerHTML assignment found in shared.js');
    assert.ok(/textContent/.test(sharedSrc), 'showToast should use textContent');
  });

  suite.test('page scripts escape external fields before HTML insertion', () => {
    const codesSrc = fs.readFileSync(path.join(__dirname, '../src/dashboard/public/js/pages/codes.js'), 'utf8');
    assert.ok(codesSrc.includes('escapeHtml(inv.label') || codesSrc.includes('escapeHtml(inv.label)'));
    const overviewSrc = fs.readFileSync(path.join(__dirname, '../src/dashboard/public/js/pages/overview.js'), 'utf8');
    assert.ok(overviewSrc.includes('escapeHtml(j.username)'));
  });

  suite.test('page scripts load the shared escapeHtml module before use', () => {
    for (const page of ['overview', 'analytics', 'codes', 'leaderboard', 'safety', 'simulator', 'settings']) {
      const html = fs.readFileSync(path.join(__dirname, `../src/dashboard/public/pages/${page}.html`), 'utf8');
      assert.ok(html.includes('/js/escapeHtml.js'), `${page}.html must load escapeHtml.js`);
    }
  });

  return suite.run();
}

module.exports = { runFrontendSafetyTests };

if (require.main === module) {
  runFrontendSafetyTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
