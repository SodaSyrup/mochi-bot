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

async function runFrontendSmokeTests() {
  const suite = new TestSuite('Frontend Shell Smoke (DOM load)');

  const pages = ['overview', 'analytics', 'leaderboard', 'codes', 'safety', 'simulator', 'settings'];

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

module.exports = { runFrontendSmokeTests };

if (require.main === module) {
  runFrontendSmokeTests().then((failed) => {
    if (typeof test !== 'function') process.exit(failed ? 1 : 0);
  });
}
