/**
 * 🍡 Mochi Multi-Page Dashboard - Shared Client Library
 */

/**
 * Centralized API client. JSON serialization, 401 -> redirect to login,
 * 403 -> authorization error, consistent error extraction. No business rules.
 */
async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }

  if (res.status === 401) {
    // Redirect to login only if we are not already on the login flow, to
    // avoid a reload storm when login is temporarily unavailable.
    if (!window.location.pathname.startsWith('/auth/') && !window.location.search.includes('error=')) {
      window.location.href = '/auth/login';
    }
    const err = new Error('UNAUTHORIZED');
    err.status = 401;
    throw err;
  }
  if (res.status === 403) {
    const err = new Error(data?.error?.message || 'You do not have permission to access this resource.');
    err.status = 403;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

class MochiSharedCore {
  constructor() {
    this.currentGuildId = null;
    this.guilds = [];
    this.socket = null;
    this.guildChangeCallbacks = [];
    this.realtimeCallbacks = {
      memberJoin: [],
      memberLeave: [],
      inviteCreated: [],
      inviteLabelUpdated: [],
      inviteDeleted: [],
      autoModExecution: [],
      autoModRuleUpdated: []
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  async init() {
    this.extractGuildFromUrlOrStorage();
    this.setupNavigationLinks();
    this.setupSocket();
    this.setupGuildSelect();
    await this.fetchUser();
    await this.fetchStats();
    await this.fetchGuilds();
  }

  /**
   * Determine initial guild from ?guild= query param or localStorage
   */
  extractGuildFromUrlOrStorage() {
    const params = new URLSearchParams(window.location.search);
    const urlGuild = params.get('guild');
    if (urlGuild) {
      this.currentGuildId = urlGuild;
      localStorage.setItem('mochi_selected_guild', urlGuild);
    } else {
      const storedGuild = localStorage.getItem('mochi_selected_guild');
      if (storedGuild) {
        this.currentGuildId = storedGuild;
      }
    }
  }

  /**
   * Keep ?guild= query parameter intact when clicking sidebar nav links
   */
  setupNavigationLinks() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('http')) {
          if (this.currentGuildId) {
            e.preventDefault();
            const url = new URL(href, window.location.origin);
            url.searchParams.set('guild', this.currentGuildId);
            window.location.href = url.pathname + url.search;
          }
        }
      });
    });
  }

  /**
   * Initialize Socket.io connection and real-time listeners
   */
  setupSocket() {
    if (typeof io === 'undefined') return;

    this.socket = io();

    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected to Mochi Gateway');
      if (this.currentGuildId) {
        this.socket.emit('joinGuild', this.currentGuildId, (response) => {
          if (response && !response.success) {
            console.warn('[WebSocket] Guild room join denied:', response.error);
          }
        });
      }
    });

    this.socket.on('memberJoin', (data) => {
      console.log('[WebSocket] Live Member Join:', data);
      const inviterText = data.isFake
        ? { text: ' (Suspicious)' }
        : { text: ` (Invited by ${data.inviter?.username || 'Vanity/Unknown'})` };
      const parts = [
        { b: data.member?.username || 'Unknown' },
        { text: ' joined using ' },
        { code: data.attribution?.inviteCode || data.attribution?.inviterId || 'N/A' },
        data.attribution?.type === 'VANITY' ? { text: ' (Vanity URL)' } : null,
        inviterText
      ].filter(Boolean);
      this.showToast(parts, data.isFake ? 'leave' : 'join');
      this.fetchStats();
      this.triggerRealtime('memberJoin', data);
    });

    this.socket.on('memberLeave', (data) => {
      console.log('[WebSocket] Live Member Leave:', data);
      this.showToast([{ b: data.member?.username || 'Unknown' }, { text: ' left the server.' }], 'leave');
      this.fetchStats();
      this.triggerRealtime('memberLeave', data);
    });

    this.socket.on('inviteCreated', (data) => {
      console.log('[WebSocket] New Invite Created:', data);
      const invite = data.invite || {};
      const parts = [{ text: 'New invite created: ' }, { code: invite.code || '' }];
      if (invite.label) parts.push({ text: ' (🏷️ ' + invite.label + ')' });
      this.showToast(parts, 'success');
      this.triggerRealtime('inviteCreated', data);
    });

    this.socket.on('inviteLabelUpdated', (payload) => {
      console.log('[WebSocket] Invite Label Updated:', payload);
      this.triggerRealtime('inviteLabelUpdated', payload);
    });

    this.socket.on('inviteDeleted', (payload) => {
      console.log('[WebSocket] Invite Deleted:', payload);
      this.triggerRealtime('inviteDeleted', payload);
    });

    this.socket.on('autoModExecution', (data) => {
      console.log('[WebSocket] AutoMod Action Executed:', data);
      this.triggerRealtime('autoModExecution', data);
    });

    this.socket.on('autoModRuleUpdated', (payload) => {
      console.log('[WebSocket] AutoMod Rule Updated:', payload);
      this.triggerRealtime('autoModRuleUpdated', payload);
    });
  }

  /**
   * Setup guild selector change event
   */
  setupGuildSelect() {
    const select = document.getElementById('guild-select');
    if (!select) return;

    select.addEventListener('change', (e) => {
      const newGuildId = e.target.value;
      if (newGuildId && newGuildId !== 'loading') {
        this.selectGuild(newGuildId, true);
      }
    });
  }

  /**
   * Switch active guild
   * @param {string} guildId
   * @param {boolean} updateUrl - whether to refresh the URL with the new guild
   */
  selectGuild(guildId, updateUrl = false) {
    if (this.currentGuildId && this.socket) {
      this.socket.emit('leaveGuild', this.currentGuildId);
    }

    this.currentGuildId = guildId;
    localStorage.setItem('mochi_selected_guild', guildId);

    if (this.socket) {
      this.socket.emit('joinGuild', guildId, (response) => {
        if (response && !response.success) {
          console.warn('[WebSocket] Guild room join denied:', response.error);
        }
      });
    }

    const select = document.getElementById('guild-select');
    if (select && select.value !== guildId) {
      select.value = guildId;
    }

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('guild', guildId);
      window.history.replaceState({}, '', url.pathname + url.search);
    }

    // Trigger page callbacks
    this.guildChangeCallbacks.forEach(cb => {
      try {
        cb(guildId);
      } catch (err) {
        console.error('Error in guild change callback:', err);
      }
    });
  }

  /**
   * Register a callback to be run when the active guild is loaded or changes
   */
  onGuildChange(callback) {
    this.guildChangeCallbacks.push(callback);
    if (this.currentGuildId) {
      callback(this.currentGuildId);
    }
  }

  /**
   * Subscribe to WebSocket events
   */
  onRealtime(event, callback) {
    if (this.realtimeCallbacks[event]) {
      this.realtimeCallbacks[event].push(callback);
    }
  }

  triggerRealtime(event, data) {
    if (this.realtimeCallbacks[event]) {
      this.realtimeCallbacks[event].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in realtime callback for ${event}:`, e);
        }
      });
    }
  }

  /**
   * Fetch authenticated user details
   */
  async fetchUser() {
    try {
      const data = await apiFetch('/auth/user');
      if (data.authenticated && data.user) {
        const nameEl = document.getElementById('user-name');
        const avatarEl = document.getElementById('user-avatar');
        const roleEl = document.getElementById('user-role');
        if (nameEl) nameEl.textContent = data.user.username;
        if (avatarEl) avatarEl.src = data.user.avatar;
        if (roleEl) {
          roleEl.textContent = data.user.isDemo
            ? 'Admin (Demo Sandbox)'
            : (data.user.isDev ? 'Development Admin' : 'Discord Authenticated');
        }
      }
    } catch (e) {
      console.error('Error fetching user:', e);
    }
  }

  /**
   * Fetch global bot telemetry
   */
  async fetchStats() {
    try {
      const data = await apiFetch('/api/stats');

      const pingEl = document.getElementById('stat-bot-ping');
      const ramEl = document.getElementById('stat-ram-usage');
      if (pingEl) pingEl.textContent = `${data.bot.ping} ms`;
      if (ramEl) ramEl.textContent = `${data.telemetry.ramMB} MB`;

      const modeBadge = document.getElementById('bot-mode-badge');
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('bot-status-text');

      if (modeBadge && statusDot && statusText) {
        if (data.bot.connected) {
          modeBadge.textContent = 'LIVE DISCORD';
          modeBadge.style.background = 'rgba(16, 185, 129, 0.2)';
          modeBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          modeBadge.style.color = '#10b981';
          statusDot.className = 'status-dot';
          statusText.textContent = `Connected as ${data.bot.tag}`;
        } else {
          modeBadge.textContent = 'SANDBOX MODE';
          statusDot.className = 'status-dot sandbox';
          statusText.textContent = 'Sandbox Engine Ready';
        }
      }

      const statusBox = document.getElementById('bot-connect-status-box');
      if (statusBox) {
        statusBox.textContent = '';
        const inner = document.createElement('div');
        if (data.bot.connected) {
          inner.appendChild(document.createElement('b')).textContent = 'Connected to Discord';
          inner.appendChild(document.createTextNode(' as '));
          const code = document.createElement('code');
          code.textContent = data.bot.tag;
          inner.appendChild(code);
          inner.appendChild(document.createTextNode('. Bot is actively listening to gateway events.'));
        } else {
          inner.appendChild(document.createElement('b')).textContent = 'Running in Sandbox Demo Mode';
          inner.appendChild(document.createTextNode('. Bot is operational locally with SQLite persistence & real-time WebSocket simulator.'));
        }
        statusBox.appendChild(inner);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  }

  /**
   * Fetch all manageable guilds
   */
  async fetchGuilds() {
    try {
      const data = await apiFetch('/api/guilds');
      this.guilds = data.guilds || [];

      const select = document.getElementById('guild-select');
      if (select) {
        select.innerHTML = '';
        this.guilds.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          select.appendChild(opt);
        });

        // Determine which guild to pick
        let chosenGuildId = this.currentGuildId;
        const exists = this.guilds.some(g => g.id === chosenGuildId);
        if (!exists && this.guilds.length > 0) {
          chosenGuildId = this.guilds[0].id;
        }

        if (chosenGuildId) {
          select.value = chosenGuildId;
          this.selectGuild(chosenGuildId, false);
        }
      }
    } catch (e) {
      console.error('Error fetching guilds:', e);
      if (e.status === 403) {
        this.showToast('You do not have permission to view any guilds.', 'leave');
      }
    }
  }

  /**
   * Floating Toast Notifications. Content is a string (plain text) or an array
   * of segments: { text } | { b } (bold) | { code }. Text is always rendered
   * via textContent — external data can never inject HTML.
   */
  showToast(content, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const inner = document.createElement('div');

    const segments = Array.isArray(content) ? content : [{ text: content }];
    for (const seg of segments) {
      if (!seg) continue;
      if (seg.b) {
        const el = document.createElement('b');
        el.textContent = seg.b;
        inner.appendChild(el);
      } else if (seg.code) {
        const el = document.createElement('code');
        el.textContent = seg.code;
        inner.appendChild(el);
      } else {
        inner.appendChild(document.createTextNode(seg.text || ''));
      }
    }

    toast.appendChild(inner);
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

const Mochi = new MochiSharedCore();
window.Mochi = Mochi;
window.apiFetch = apiFetch;
window.escapeHtml = escapeHtml;
