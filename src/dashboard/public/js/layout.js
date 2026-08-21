/**
 * 🍡 Mochi Dashboard — Shared application shell.
 *
 * Single source of truth for the sidebar, topbar, navigation config, mobile
 * drawer, and the compact connection status. Every page exposes shell roots:
 *
 *   <div id="sidebar-root"></div>
 *   <div id="topbar-root"></div>
 *   <div id="overlay-root"></div>
 *
 * and declares its active page once:
 *
 *   <body data-page="overview">
 *
 * There is no per-page duplicated shell markup anymore. Exposes
 * `window.MochiLayout` used by shared.js (user + status + guild select).
 */
(function (global) {
  'use strict';

  const NAV_GROUPS = [
    {
      label: 'Invites',
      items: [
        { page: 'overview', href: '/', icon: 'fa-gauge', label: 'Overview' },
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
      ],
    },
    {
      label: 'System',
      items: [
        { page: 'simulator', href: '/simulator', icon: 'fa-flask', label: 'Simulator' },
        { page: 'settings', href: '/settings', icon: 'fa-sliders', label: 'Settings' },
      ],
    },
  ];

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

    const footer = el('div', { className: 'sidebar-footer' }, [
      el('div', { className: 'sidebar-status', id: 'sidebar-status', 'data-status': 'loading' }, [
        el('span', { className: 'status-dot', 'aria-hidden': 'true' }),
        el('span', { className: 'status-text', id: 'bot-status-text' }, ['Loading…']),
      ]),
    ]);

    sidebar.append(header, nav, footer);
    root.appendChild(sidebar);
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
        el('img', { className: 'user-avatar', id: 'user-avatar', src: 'https://cdn.discordapp.com/embed/avatars/0.png', alt: 'Your avatar' }),
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
    document.querySelectorAll('.sidebar-nav .nav-item').forEach((link) => {
      link.addEventListener('click', (e) => {
        closeDrawer();
        const href = link.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('http')) {
          const currentGuildId = global.Mochi?.currentGuildId;
          if (currentGuildId) {
            e.preventDefault();
            const url = new URL(href, global.location.origin);
            url.searchParams.set('guild', currentGuildId);
            global.location.href = url.pathname + url.search;
          }
        }
      });
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
   * 'connected' | 'demo' | 'disconnected' | 'loading'. CSS owns the colors.
   */
  function setStatus({ status = 'loading', text = '' } = {}) {
    const root = document.getElementById('sidebar-status');
    const textEl = document.getElementById('bot-status-text');
    if (root) root.dataset.status = status;
    if (textEl) textEl.textContent = text;
  }

  function init() {
    if (!document.getElementById('sidebar-root')) return;
    buildSidebar();
    buildTopbar();
    buildOverlay();
    setupNavigationLinks();
    setupDrawer();
  }

  const MochiLayout = { init, setUser, setStatus, NAV_GROUPS };
  global.MochiLayout = MochiLayout;

  // CommonJS export for unit tests (mirrors escapeHtml.js). In the browser the
  // module is loaded as a plain <script> and runs immediately.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NAV_GROUPS, findNavItem, MochiLayout };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
