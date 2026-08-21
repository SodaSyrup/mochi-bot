/**
 * 🍡 Mochi Dashboard — Shared client library.
 *
 * Centralizes the API client, guild selection/persistence, Socket.IO realtime
 * subscriptions, safe toasts, and connection status. The application shell
 * (sidebar/topbar/navigation) lives in layout.js — nothing here builds markup
 * for it.
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

/**
 * Map bot telemetry to a semantic status. Colors belong to CSS via
 * `data-status`; this function returns only the semantic state and plain text.
 */
function resolveBotStatus({ connected = false, demoMode = false, tag = '' } = {}) {
  if (connected) return { status: 'connected', text: `Connected · ${tag}` };
  if (demoMode) return { status: 'demo', text: 'Demo mode' };
  return { status: 'disconnected', text: 'Disconnected' };
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
    this.setupSocket();
    this.setupGuildSelect();
    await Promise.all([this.fetchUser(), this.fetchStats()]);
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
   * Initialize Socket.io connection and real-time listeners
   */
  setupSocket() {
    if (typeof io === 'undefined') return;

    this.socket = io();

    this.socket.on('connect', () => {
      if (this.currentGuildId) {
        this.socket.emit('joinGuild', this.currentGuildId, (response) => {
          if (response && !response.success) {
            console.warn('[WebSocket] Guild room join denied:', response.error);
          }
        });
      }
    });

    this.socket.on('memberJoin', (data) => {
      const inviterText = data.isFake
        ? ' (Suspicious)'
        : ` (Invited by ${data.inviter?.username || 'Vanity/Unknown'})`;
      const parts = [
        { b: data.member?.username || 'Unknown' },
        { text: ' joined using ' },
        { code: data.attribution?.inviteCode || data.attribution?.inviterId || 'N/A' },
        data.attribution?.type === 'VANITY' ? { text: ' (Vanity URL)' } : null,
        { text: inviterText }
      ].filter(Boolean);
      this.showToast(parts, data.isFake ? 'leave' : 'join');
      this.fetchStats();
      this.triggerRealtime('memberJoin', data);
    });

    this.socket.on('memberLeave', (data) => {
      this.showToast([{ b: data.member?.username || 'Unknown' }, { text: ' left the server.' }], 'leave');
      this.fetchStats();
      this.triggerRealtime('memberLeave', data);
    });

    this.socket.on('inviteCreated', (data) => {
      const invite = data.invite || {};
      const parts = [{ text: 'New invite created: ' }, { code: invite.code || '' }];
      if (invite.label) parts.push({ text: ` (${invite.label})` });
      this.showToast(parts, 'success');
      this.triggerRealtime('inviteCreated', data);
    });

    this.socket.on('inviteLabelUpdated', (payload) => {
      this.triggerRealtime('inviteLabelUpdated', payload);
    });

    this.socket.on('inviteDeleted', (payload) => {
      this.triggerRealtime('inviteDeleted', payload);
    });

    this.socket.on('autoModExecution', (data) => {
      this.triggerRealtime('autoModExecution', data);
    });

    this.socket.on('autoModRuleUpdated', (payload) => {
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
   * Fetch authenticated user details and render into the shared topbar.
   */
  async fetchUser() {
    try {
      const data = await apiFetch('/auth/user');
      if (data.authenticated && data.user && window.MochiLayout) {
        window.MochiLayout.setUser({
          username: data.user.username,
          avatar: data.user.avatar,
        });
      }
    } catch (e) {
      console.error('Error fetching user:', e);
    }
  }

  /**
   * Fetch bot connection state and render semantic status. Colors are applied
   * by CSS from data-status, never from JavaScript color strings.
   */
  async fetchStats() {
    try {
      const data = await apiFetch('/api/stats');

      const connected = Boolean(data.bot.connected);
      const demo = Boolean(data.bot.demoMode);
      const { status, text } = resolveBotStatus({
        connected,
        demoMode: demo,
        tag: data.bot.tag || 'Mochi#0000',
      });

      if (window.MochiLayout) {
        window.MochiLayout.setStatus({ status, text });
      }

      const ping = `${data.bot.ping} ms`;
      const ram = `${data.telemetry.ramMB} MB`;

      // Compact status line (Overview) — plain sentence, no drama.
      const statusLine = document.getElementById('bot-status-line');
      if (statusLine) {
        statusLine.textContent = `${text} · ${ping} latency · ${ram} memory`;
      }

      // Settings definition list (Bot status section).
      const setDiscord = document.getElementById('settings-discord');
      const setBot = document.getElementById('settings-bot');
      const setMode = document.getElementById('settings-mode');
      const setLatency = document.getElementById('settings-latency');
      const setMemory = document.getElementById('settings-memory');
      if (setDiscord) setDiscord.textContent = connected ? 'Connected' : demo ? 'Demo' : 'Disconnected';
      if (setBot) setBot.textContent = data.bot.tag || 'Mochi#0000';
      if (setMode) setMode.textContent = demo ? 'Demo' : 'Development';
      if (setLatency) setLatency.textContent = ping;
      if (setMemory) setMemory.textContent = ram;

      // Setup instructions only make sense when Discord is genuinely absent.
      const setupBox = document.getElementById('setup-instructions');
      if (setupBox) {
        setupBox.style.display = connected || demo ? 'none' : 'block';
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
    toast.setAttribute('role', 'status');

    const indicator = document.createElement('span');
    indicator.className = 'toast-indicator';
    indicator.setAttribute('aria-hidden', 'true');

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

    toast.append(indicator, inner);
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(4px)';
      window.setTimeout(() => toast.remove(), 200);
    }, 4000);
  }
}

if (typeof window !== 'undefined') {
  const Mochi = new MochiSharedCore();
  window.Mochi = Mochi;
  window.apiFetch = apiFetch;
  window.escapeHtml = escapeHtml;

  // Shared modal behavior: Escape and backdrop clicks close the open modal(s).
  // Pages listen for `mochi:close-modals` and run their own close routines so
  // per-modal state stays consistent. Never used for destructive confirms
  // (those use the native confirm() dialog).
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
      window.dispatchEvent(new CustomEvent('mochi:close-modals'));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.dispatchEvent(new CustomEvent('mochi:close-modals'));
    }
  });
}

// CommonJS export for unit tests. The Mochi core and shell wiring only run in
// a browser; the pure helpers are exported for Bun tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolveBotStatus, apiFetch, MochiSharedCore };
}
