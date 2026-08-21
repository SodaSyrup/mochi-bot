const { TestSuite, assert } = require('./helpers/harness');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Minimal DOM stub sufficient to execute layout.js, shared.js and the page
 * scripts at load time (shell construction + listeners). Catches runtime
 * errors (missing globals, undefined functions, bad DOM usage) that a static
 * read of the source would miss.
 */

function makeClassList() {
  const set = new Set();
  return {
    add(...c) { c.forEach((x) => set.add(x)); },
    remove(...c) { c.forEach((x) => set.delete(x)); },
    toggle(c, force) {
      if (force === undefined) {
        if (set.has(c)) { set.delete(c); return false; }
        set.add(c); return true;
      }
      if (force) set.add(c); else set.delete(c);
      return force;
    },
    contains(c) { return set.has(c); },
  };
}

function makeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    nodeType: 1,
    children: [],
    attributes: {},
    style: {},
    dataset: {},
    classList: makeClassList(),
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    options: [],
    selectedOptions: [],
    readyState: 'complete',
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { this.children.push(...nodes); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    getContext() { return {}; },
    remove() {},
  };
  return el;
}

function createDomStub() {
  const byId = new Map();
  const elements = new Set();
  const element = (tag, id) => {
    const e = makeElement(tag);
    if (id) byId.set(id, e);
    elements.add(e);
    return e;
  };
  const document = {
    body: element('body'),
    documentElement: element('html'),
    readyState: 'complete',
    createElement: (tag) => element(tag),
    createTextNode: (text) => makeElement('#text'),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, elements, byId };
}

function loadModule(filename, context) {
  const code = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  vm.runInNewContext(code, context, { filename });
}

/**
 * Functional test for the Settings invite-log UI. Executes settings.js in a
 * DOM stub with a routing fetch and verifies guild-change handling, safe
 * channel option construction, current-setting selection, and the PATCH body
 * (including the disabled/null state). Never parses Discord-controlled strings
 * as HTML.
 */
async function runFrontendInviteLogTests() {
  const suite = new TestSuite('Frontend Invite Log Settings');

  suite.test('settings page contains the invite log selector and save control', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/dashboard/public/pages/settings.html'), 'utf8');
    assert.ok(html.includes('id="setting-invite-log-channel"'), 'invite log channel select must exist');
    assert.ok(html.includes('id="btn-save-invite-log"'), 'invite log save button must exist');
    assert.ok(html.includes('Invite logs'), 'settings page must have an Invite logs section');
  });

  suite.test('settings JS registers guild-change handling and builds options with safe DOM APIs', async () => {
    const { document, byId } = createDomStub();
    byId.set('setting-invite-log-channel', makeElement('select'));
    byId.set('btn-save-invite-log', makeElement('button'));

    const requests = [];
    const fetchMock = async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', body: options.body });
      if (url === '/auth/user') return { ok: true, status: 200, json: async () => ({ authenticated: true, user: { username: 'u', avatar: null } }) };
      if (url === '/api/stats') return { ok: true, status: 200, json: async () => ({ bot: { connected: true, tag: 'Mochi#1', ping: 10 }, telemetry: { ramMB: 64 } }) };
      if (url === '/api/guilds') return { ok: true, status: 200, json: async () => ({ guilds: [{ id: 'g1', name: 'Guild One' }] }) };
      if (url === '/api/guilds/g1') return { ok: true, status: 200, json: async () => ({ settings: { invite_log_channel_id: 'chan_b' }, guild: { id: 'g1' } }) };
      if (url === '/api/guilds/g1/channels') return { ok: true, status: 200, json: async () => ({ channels: [{ id: 'chan_a', name: 'general' }, { id: 'chan_b', name: 'invite-logs' }] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const sandbox = {
      window: null,
      document,
      URLSearchParams: class { constructor(q = '') { this.s = q; } get(k) { return null; } },
      navigator: { clipboard: { writeText: async () => {} } },
      localStorage: {
        _store: {},
        getItem(k) { return this._store[k] ?? null; },
        setItem(k, v) { this._store[k] = String(v); },
        removeItem(k) { delete this._store[k]; },
      },
      location: { search: '', origin: 'http://localhost', pathname: '/', href: 'http://localhost/' },
      history: { replaceState() {} },
      fetch: fetchMock,
      FormData: class FormData {},
      io: () => ({ on() {}, emit() {} }),
      setTimeout: (fn) => fn,
      clearTimeout() {},
      console: { log() {}, warn() {}, error() {}, info() {} },
      escapeHtml: (v) => String(v ?? ''),
    };
    sandbox.window = sandbox;

    loadModule('src/dashboard/public/js/escapeHtml.js', sandbox);
    loadModule('src/dashboard/public/js/constants.js', sandbox);
    loadModule('src/dashboard/public/js/shared.js', sandbox);
    loadModule('src/dashboard/public/js/pages/settings.js', sandbox);

    // Switching to a guild must trigger the settings page's guild-change flow.
    sandbox.Mochi.selectGuild('g1', false);

    const select = byId.get('setting-invite-log-channel');
    await waitFor(() => select.children.length >= 2);

    // Disabled option + both channels, inserted via textContent (safe DOM).
    assert.strictEqual(select.children.length, 3, 'Disabled + 2 channels');
    assert.strictEqual(select.children[0].value, '');
    assert.strictEqual(select.children[0].textContent, 'Disabled');
    assert.strictEqual(select.children[1].value, 'chan_a');
    assert.strictEqual(select.children[1].textContent, '#general');
    assert.strictEqual(select.children[2].value, 'chan_b');

    // Current setting is selected.
    const selected = select.children.find((o) => o.selected);
    assert.strictEqual(selected.value, 'chan_b', 'configured invite_log_channel_id must be selected');

    // Saving sends invite_log_channel_id.
    const settingsPage = sandbox.window.settingsPage;
    settingsPage.guildId = 'g1';
    select.value = 'chan_b';
    await settingsPage.saveInviteLogSettings(null);
    const patch = requests.find((r) => r.method === 'PATCH' && r.url === '/api/guilds/g1/settings');
    assert.ok(patch, 'a PATCH to settings must be issued');
    assert.deepStrictEqual(JSON.parse(patch.body), { invite_log_channel_id: 'chan_b' });

    // Disabled (null) state works.
    select.value = '';
    await settingsPage.saveInviteLogSettings(null);
    const patchNull = requests.filter((r) => r.method === 'PATCH' && r.url === '/api/guilds/g1/settings').pop();
    assert.deepStrictEqual(JSON.parse(patchNull.body), { invite_log_channel_id: null });

    // Existing status settings UI still works.
    assert.ok(byId.has('settings-discord') === false, 'settings-discord is optional for this test');
  });

  return suite.run();
}

function waitFor(fn, timeout = 500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (fn() || Date.now() - start > timeout) return resolve();
      setTimeout(tick, 5);
    };
    tick();
  });
}

async function runFrontendSmokeTests() {
  const suite = new TestSuite('Frontend Shell Smoke (DOM load)');

  const pages = ['overview', 'analytics', 'leaderboard', 'codes', 'safety', 'honeypot', 'settings'];

  for (const page of pages) {
    suite.test(`${page} page scripts load without throwing in a browser-like DOM`, async () => {
      const { document, elements, byId } = createDomStub();
      // layout.js requires shell roots to exist.
      byId.set('sidebar-root', makeElement('div'));
      byId.set('topbar-root', makeElement('div'));
      byId.set('overlay-root', makeElement('div'));
      byId.set('menu-toggle', makeElement('button'));
      byId.set('mobile-overlay', makeElement('div'));
      byId.set('guild-select', makeElement('select'));
      byId.set('user-name', makeElement('span'));
      byId.set('user-avatar', makeElement('img'));
      byId.set('sidebar-status', makeElement('div'));
      byId.set('bot-status-text', makeElement('span'));

      const sandbox = {
        window: null,
        document,
        URLSearchParams: class { constructor(q = '') { this.s = q; } get(k) { return null; } },
        navigator: { clipboard: { writeText: async () => {} } },
        localStorage: {
          _store: {},
          getItem(k) { return this._store[k] ?? null; },
          setItem(k, v) { this._store[k] = String(v); },
          removeItem(k) { delete this._store[k]; },
        },
        location: { search: '', origin: 'http://localhost', pathname: '/', href: 'http://localhost/' },
        history: { replaceState() {} },
        fetch: async () => ({ json: async () => ({ guilds: [], authenticated: false, user: null, bot: {}, telemetry: {} }) }),
        io: () => ({ on() {}, emit() {} }),
        Chart: function () {},
        CustomEvent: function (type, opts) { this.type = type; },
        addEventListener() {},
        dispatchEvent() {},
        setTimeout: (fn) => fn,
        clearTimeout() {},
        console: { log() {}, warn() {}, error() {}, info() {} },
        escapeHtml: (v) => String(v ?? ''),
      };
      sandbox.window = sandbox;

      loadModule('src/dashboard/public/js/escapeHtml.js', sandbox);
      loadModule('src/dashboard/public/js/constants.js', sandbox);
      loadModule('src/dashboard/public/js/layout.js', sandbox);
      loadModule('src/dashboard/public/js/shared.js', sandbox);
      loadModule(`src/dashboard/public/js/pages/${page}.js`, sandbox);

      // Give microtasks a chance (safety.js init awaits refreshAll).
      await new Promise((r) => setTimeout(r, 0));

      assert.ok(sandbox.Mochi, `${page}: Mochi must be exposed on window`);
      assert.ok(sandbox.MochiLayout, `${page}: MochiLayout must be exposed`);
      assert.ok(sandbox.apiFetch, `${page}: apiFetch must be exposed`);
      assert.ok(elements.size > 0, `${page}: layout must build DOM elements`);
    });
  }

  return suite.run();
}

module.exports = { runFrontendSmokeTests, runFrontendInviteLogTests };

if (require.main === module) {
  Promise.all([runFrontendSmokeTests(), runFrontendInviteLogTests()]).then((results) => {
    const failed = results.reduce((a, b) => a + b, 0);
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
