/** Dashboard shell, navigation, and compact connection status.
 *
 *   <div id="sidebar-root"></div>
 *   <div id="topbar-root"></div>
 *   <div id="overlay-root"></div>
 *
 * and declares its active page once:
 *
 *   <body data-page="overview">
 *
 * Exposes `window.MochiLayout` for shared.js.
 */
(function (global) {
  'use strict';

  const CONSTANTS = global.MochiConstants;

  const NAV_GROUPS = [
    {
      label: 'Invites',
      items: [
        { page: 'overview', href: '/dashboard', icon: 'fa-gauge', label: 'Overview' },
        { page: 'analytics', href: '/analytics', icon: 'fa-chart-line', label: 'Analytics' },
        { page: 'leaderboard', href: '/leaderboard', icon: 'fa-ranking-star', label: 'Leaderboard' },
        { page: 'codes', href: '/codes', icon: 'fa-link', label: 'Invite links' },
      ],
    },
    {
      label: 'Moderation',
      items: [
        { page: 'safety', href: '/safety', icon: 'fa-shield-halved', label: 'Safety' },
        { page: 'honeypot', href: '/honeypot', icon: 'fa-jar', label: 'Honeypot' },
        { page: 'permission-groups', href: '/permission-groups', icon: 'fa-layer-group', label: 'Permission groups' },
      ],
    },
    {
      label: 'System',
      items: [
        { page: 'settings', href: '/settings', icon: 'fa-sliders', label: 'Settings' },
      ],
    },
  ];

  // Kept separate from NAV_GROUPS so older integrations that consume the
  // exported navigation structure remain compatible while the dashboard can
  // expose the new per-guild plugin controls.
  const PLUGIN_NAV_ITEM = { page: 'plugins', href: '/plugins', icon: 'fa-puzzle-piece', label: 'Plugins' };
  const GLOBAL_BAN_NAV_ITEM = { page: 'global-bans', href: '/global-bans', icon: 'fa-globe', label: 'Global protection' };
  const GLOBAL_BAN_REGISTRY_NAV_ITEM = { page: 'global-ban-registry', href: '/global-ban-registry', icon: 'fa-list-check', label: 'Global registry' };

  function currentPage() {
    return document.body.dataset.page || 'overview';
  }

  /**
   * Find the navigation item for a page key. Returns undefined when the page
   * key is unknown. Pure — used by buildSidebar and unit tests.
   */
  function findNavItem(page) {
    for (const group of NAV_GROUPS) {
      const found = group.items.find((item) => item.page === page);
      if (found) return found;
    }
    if (page === PLUGIN_NAV_ITEM.page) return PLUGIN_NAV_ITEM;
    if (page === GLOBAL_BAN_NAV_ITEM.page) return GLOBAL_BAN_NAV_ITEM;
    if (page === GLOBAL_BAN_REGISTRY_NAV_ITEM.page) return GLOBAL_BAN_REGISTRY_NAV_ITEM;
    return undefined;
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null) continue;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('data-') || key === 'aria-label' || key === 'aria-current' || key === 'aria-hidden') node.setAttribute(key, value);
        else node[key] = value;
      }
    }
    for (const child of children || []) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function buildSidebar() {
    const root = document.getElementById('sidebar-root');
    if (!root) return;

    const page = currentPage();

    const sidebar = el('aside', { className: 'sidebar', id: 'sidebar' });
    const header = el('div', { className: 'sidebar-header' }, [
      el('span', { className: 'brand-logo', 'aria-hidden': 'true' }, ['🍡']),
      el('div', { className: 'brand-title' }, [el('h1', {}, ['Mochi'])]),
    ]);

    const nav = el('nav', { className: 'sidebar-nav', 'aria-label': 'Main navigation' });
    for (const group of NAV_GROUPS) {
      nav.appendChild(el('div', { className: 'nav-section-title' }, [group.label]));
      for (const item of group.items) {
        const link = el(
          'a',
          {
            className: 'nav-item',
            href: item.href,
            'data-page': item.page,
            'aria-current': item.page === page ? 'page' : 'false',
          },
          [
            el('i', { className: `fa-solid ${item.icon}`, 'aria-hidden': 'true' }),
            el('span', {}, [item.label]),
          ]
        );
        if (item.page === page) link.classList.add('active');
        nav.appendChild(link);
      }
    }

    const pluginLink = el(
      'a',
      {
        className: 'nav-item',
        href: PLUGIN_NAV_ITEM.href,
        'data-page': PLUGIN_NAV_ITEM.page,
        'aria-current': PLUGIN_NAV_ITEM.page === page ? 'page' : 'false',
      },
      [
        el('i', { className: `fa-solid ${PLUGIN_NAV_ITEM.icon}`, 'aria-hidden': 'true' }),
        el('span', {}, [PLUGIN_NAV_ITEM.label]),
      ]
    );
    if (PLUGIN_NAV_ITEM.page === page) pluginLink.classList.add('active');
    nav.appendChild(pluginLink);

    const globalBanLink = el('a', {
      className: 'nav-item', href: GLOBAL_BAN_NAV_ITEM.href, 'data-page': GLOBAL_BAN_NAV_ITEM.page,
      'aria-current': GLOBAL_BAN_NAV_ITEM.page === page ? 'page' : 'false',
    }, [
      el('i', { className: `fa-solid ${GLOBAL_BAN_NAV_ITEM.icon}`, 'aria-hidden': 'true' }),
      el('span', {}, [GLOBAL_BAN_NAV_ITEM.label]),
    ]);
    if (GLOBAL_BAN_NAV_ITEM.page === page) globalBanLink.classList.add('active');
    nav.appendChild(globalBanLink);

    if (global.Mochi?.capabilities?.globalBanRegistry) appendRegistryLink(nav, page);

    const footer = el('div', { className: 'sidebar-footer' }, [
      el('div', { className: 'sidebar-status', id: 'sidebar-status', 'data-status': 'loading' }, [
        el('span', { className: 'status-dot', 'aria-hidden': 'true' }),
        el('span', { className: 'status-text', id: 'bot-status-text' }, ['Loading…']),
      ]),
    ]);

    sidebar.append(header, nav, footer);
    root.appendChild(sidebar);
  }

  function appendRegistryLink(nav, page = currentPage()) {
    if (!nav || nav.querySelector('[data-page="global-ban-registry"]')) return;
    const item = GLOBAL_BAN_REGISTRY_NAV_ITEM;
    const link = el('a', {
      className: 'nav-item', href: item.href, 'data-page': item.page,
      'aria-current': item.page === page ? 'page' : 'false',
    }, [
      el('i', { className: `fa-solid ${item.icon}`, 'aria-hidden': 'true' }),
      el('span', {}, [item.label]),
    ]);
    if (item.page === page) link.classList.add('active');
    nav.appendChild(link);
    bindNavigationLink(link);
  }

  function bindNavigationLink(link) {
    // Navigation is handled once on the document, including links added later.
    const guildId = global.Mochi?.currentGuildId;
    if (guildId && link.getAttribute('href') !== '/global-ban-registry') {
      const url = new URL(link.getAttribute('href'), global.location.origin);
      url.searchParams.set('guild', guildId);
      link.href = url.pathname + url.search;
    }
  }

  function buildTopbar() {
    const root = document.getElementById('topbar-root');
    if (!root) return;

    const topbar = el('header', { className: 'topbar' });

    const left = el('div', { className: 'topbar-left' }, [
      el('button', { className: 'menu-toggle', id: 'menu-toggle', 'aria-label': 'Open navigation', title: 'Open navigation' }, [
        el('i', { className: 'fa-solid fa-bars', 'aria-hidden': 'true' }),
      ]),
      el('select', { className: 'guild-selector', id: 'guild-select', 'aria-label': 'Select server' }, [
        el('option', { value: 'loading' }, ['Loading servers…']),
      ]),
    ]);

    const right = el('div', { className: 'topbar-right' }, [
      el('div', { className: 'user-profile' }, [
        el('img', { className: 'user-avatar', id: 'user-avatar', src: CONSTANTS.discord.defaultAvatar, alt: 'Your avatar' }),
        el('span', { className: 'user-name', id: 'user-name' }, ['…']),
      ]),
      el('a', { className: 'topbar-logout', href: '/auth/logout', 'aria-label': 'Sign out', title: 'Sign out' }, [
        el('i', { className: 'fa-solid fa-right-from-bracket', 'aria-hidden': 'true' }),
        el('span', { className: 'logout-label' }, ['Sign out']),
      ]),
    ]);

    topbar.append(left, right);
    root.appendChild(topbar);
  }

  function buildOverlay() {
    const root = document.getElementById('overlay-root');
    if (!root) return;
    const overlay = el('div', { className: 'overlay', id: 'mobile-overlay', 'aria-hidden': 'true' });
    root.appendChild(overlay);
  }

  function openDrawer() {
    const toggle = document.getElementById('menu-toggle');
    const overlay = document.getElementById('mobile-overlay');
    document.body.classList.add('drawer-open');
    if (overlay) overlay.classList.add('visible');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    const toggle = document.getElementById('menu-toggle');
    const overlay = document.getElementById('mobile-overlay');
    document.body.classList.remove('drawer-open');
    if (overlay) overlay.classList.remove('visible');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  /**
   * Keep the ?guild= query parameter when navigating, and close the mobile
   * drawer after any navigation click.
   */
  function setupNavigationLinks() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(bindNavigationLink);
  }

  /** Keep the shell and each visited page mounted. Load page scripts once. */
  function setupPageNavigation() {
    const initialContent = document.querySelector('.page-container');
    if (!initialContent || typeof global.fetch !== 'function') return;

    const items = [...NAV_GROUPS.flatMap((group) => group.items), PLUGIN_NAV_ITEM, GLOBAL_BAN_NAV_ITEM, GLOBAL_BAN_REGISTRY_NAV_ITEM];
    const routes = new Map(items.map((item) => [item.href, item.page]));
    const views = new Map();
    const scripts = new Map(Array.from(document.querySelectorAll('script[src]'), (script) => [script.src, Promise.resolve()]));
    let generation = 0;
    let request = null;
    let work = Promise.resolve();

    function collectDialogs(source, move = false) {
      const container = document.createElement('div');
      container.dataset.pageDialogs = source.body.dataset.page;
      for (const dialog of source.querySelectorAll('body > .modal-overlay')) {
        container.appendChild(move ? dialog : document.importNode(dialog, true));
      }
      document.body.appendChild(container);
      return container;
    }

    views.set(global.location.pathname, {
      page: currentPage(), content: initialContent, dialogs: collectDialogs(document, true),
      title: document.title, bodyClass: document.body.className,
    });

    function loadScript(src) {
      if (!scripts.has(src)) {
        const loading = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.onload = resolve;
          script.onerror = () => {
            scripts.delete(src);
            script.remove();
            reject(new Error('Could not load the dashboard page.'));
          };
          document.body.appendChild(script);
        });
        scripts.set(src, loading);
      }
      return scripts.get(src);
    }

    function activate(view) {
      global.dispatchEvent(new CustomEvent('mochi:close-modals'));
      for (const cached of views.values()) {
        cached.content.hidden = cached !== view;
        cached.dialogs.hidden = cached !== view;
      }
      document.body.dataset.page = view.page;
      document.body.className = view.bodyClass;
      document.title = view.title;
      for (const link of document.querySelectorAll('.sidebar-nav .nav-item')) {
        const active = link.dataset.page === view.page;
        link.classList.toggle('active', active);
        link.setAttribute('aria-current', active ? 'page' : 'false');
      }
      closeDrawer();
    }

    async function changePage(url, fromHistory, version, controller) {
      const previous = views.get(global.location.pathname);
      let addedView = null;
      try {
        // Check the named server route on every visit, including cached pages.
        // Protected pages still use the server's session and capability checks.
        const response = await global.fetch(url, { credentials: 'same-origin', signal: controller.signal });
        if (version !== generation) return;
        if (response.status === 401) {
          global.location.href = '/auth/login';
          return;
        }
        if (!response.ok) throw new Error(response.status === 403
          ? 'You do not have permission to open this page.'
          : 'Could not load the dashboard page.');
        const source = new DOMParser().parseFromString(await response.text(), 'text/html');
        const content = source.querySelector('.page-container');
        if (!content || source.body.dataset.page !== routes.get(url.pathname)) {
          throw new Error('Could not load the dashboard page.');
        }

        // Load dependencies before changing the visible page. Shared scripts
        // and the Socket.IO client already exist and must not run a second time.
        const pageScripts = [];
        for (const script of source.querySelectorAll('script[src]')) {
          const src = new URL(script.getAttribute('src'), url);
          if (src.origin === global.location.origin && src.pathname.startsWith('/js/pages/')) {
            pageScripts.push(src.href);
          } else if (!scripts.has(src.href)) {
            await loadScript(src.href);
          }
        }
        if (version !== generation) return;

        let view = views.get(url.pathname);
        const isNew = !view;
        if (isNew) {
          view = {
            page: source.body.dataset.page, content: document.importNode(content, true),
            dialogs: collectDialogs(source), title: source.title, bodyClass: source.body.className,
          };
          document.querySelector('.main-content').appendChild(view.content);
          views.set(url.pathname, view);
          addedView = view;
        }
        activate(view);
        const guildId = url.searchParams.get('guild');
        const guildChanged = guildId && guildId !== global.Mochi?.currentGuildId;
        if (guildChanged) global.Mochi?.selectGuild(guildId);
        if (isNew) {
          for (const src of pageScripts) await loadScript(src);
        }

        if (!isNew && !guildChanged) {
          global.Mochi?.refreshPage();
        }
        global.Mochi?.fetchStats();
        if (!fromHistory) global.history.pushState({}, '', url.pathname + url.search + url.hash);
        global.scrollTo({ top: 0 });
        const heading = view.content.querySelector('h2, h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (addedView) {
          views.delete(url.pathname);
          addedView.content.remove();
          addedView.dialogs.remove();
        }
        if (previous) activate(previous);
        if (fromHistory) {
          // The address bar has already changed. A normal request keeps the
          // document consistent and displays the server's access error.
          global.location.reload();
        } else {
          global.Mochi?.showToast(error.message, 'leave');
        }
      } finally {
        if (version === generation) initialContent.parentElement.removeAttribute('aria-busy');
      }
    }

    function navigate(url, fromHistory = false) {
      const version = ++generation;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      initialContent.parentElement.setAttribute('aria-busy', 'true');
      // Serialize script initialization so rapid clicks cannot register a
      // controller against a different page or load its script twice.
      work = work.then(() => changePage(url, fromHistory, version, controller));
    }

    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, global.location.href);
      if (url.origin !== global.location.origin || !routes.has(url.pathname)) return;
      event.preventDefault();
      closeDrawer();
      if (!url.searchParams.has('guild') && url.pathname !== GLOBAL_BAN_REGISTRY_NAV_ITEM.href && global.Mochi?.currentGuildId) {
        url.searchParams.set('guild', global.Mochi.currentGuildId);
      }
      if (url.href !== global.location.href) navigate(url);
    });
    global.addEventListener('popstate', () => {
      const url = new URL(global.location.href);
      if (routes.has(url.pathname)) navigate(url, true);
      else global.location.reload();
    });
  }

  function setupDrawer() {
    const toggle = document.getElementById('menu-toggle');

    toggle?.addEventListener('click', () => {
      if (document.body.classList.contains('drawer-open')) closeDrawer();
      else openDrawer();
    });
    document.getElementById('mobile-overlay')?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    MochiLayout.openDrawer = openDrawer;
    MochiLayout.closeDrawer = closeDrawer;
  }

  /**
   * Render the authenticated user into the topbar (avatar + username only).
   * Implementation/auth details are intentionally not shown.
   */
  function setUser(user) {
    const nameEl = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl) nameEl.textContent = user?.username || 'Guest';
    if (avatarEl && user?.avatar) avatarEl.src = user.avatar;
  }

  /**
   * Set the sidebar connection status. `status` is semantic only:
   * 'connected' | 'disconnected' | 'loading'. CSS owns the colors.
   */
  function setStatus({ status = 'loading', text = '' } = {}) {
    const root = document.getElementById('sidebar-status');
    const textEl = document.getElementById('bot-status-text');
    if (root) root.dataset.status = status;
    if (textEl) textEl.textContent = text;
  }

  function setCapabilities(capabilities = {}) {
    const nav = document.querySelector('.sidebar-nav');
    if (capabilities.globalBanRegistry) appendRegistryLink(nav);
  }

  function init() {
    if (!document.getElementById('sidebar-root')) return;
    buildSidebar();
    buildTopbar();
    buildOverlay();
    setupNavigationLinks();
    setupDrawer();
    setupPageNavigation();
  }

  const MochiLayout = { init, setUser, setStatus, setCapabilities, updateNavigationGuild: setupNavigationLinks, NAV_GROUPS };
  global.MochiLayout = MochiLayout;

  // CommonJS export for unit tests (mirrors escapeHtml.js). In the browser the
  // module is loaded as a plain <script> and runs immediately.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NAV_GROUPS, PLUGIN_NAV_ITEM, GLOBAL_BAN_REGISTRY_NAV_ITEM, findNavItem, MochiLayout };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
