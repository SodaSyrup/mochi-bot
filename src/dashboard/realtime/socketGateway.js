const { InviteEvents, SafetyEvents, HoneypotEvents, GlobalBanEvents } = require('../../app/eventBus');
const { mapApplicationEvent } = require('./eventMappers');
const { UnauthorizedError } = require('../errors');

/** Build the room name used for a guild's socket events. */
function guildRoom(guildId) {
  return `guild_${guildId}`;
}

/** Sends authorized, guild-scoped application events over Socket.IO. */
class SocketGateway {
  constructor({ io, eventBus, guildAccess, logger, contributions = null, pluginSettings = null, sessionStore = null }) {
    this.io = io;
    this.eventBus = eventBus;
    this.guildAccess = guildAccess;
    this.logger = logger || console;
    this.pluginSettings = pluginSettings;
    this.sessionStore = sessionStore;
    this.sessionSockets = new Map();
    this.grants = new WeakMap();
    this.trackedSockets = new Set();
    this.grantTimer = setInterval(() => {
      const cutoff = Date.now() - 10000;
      for (const socket of this.trackedSockets) {
        const grants = this.grants.get(socket);
        if (!grants) continue;
        for (const [guildId, checkedAt] of grants) if (checkedAt < cutoff) grants.delete(guildId);
      }
    }, 10000);
    this.grantTimer.unref?.();

    this.subscriptions = [];
    const pluginMappings = contributions?.getRealtimeContributions?.() || [];
    const mappings = contributions
      ? pluginMappings
      : [
        { applicationEvent: InviteEvents.MemberJoined, socketEvent: 'memberJoin', map: (data) => mapApplicationEvent(InviteEvents.MemberJoined, data), pluginId: 'core-compat' },
        { applicationEvent: InviteEvents.MemberLeft, socketEvent: 'memberLeave', map: (data) => mapApplicationEvent(InviteEvents.MemberLeft, data), pluginId: 'core-compat' },
        { applicationEvent: InviteEvents.InviteCreated, socketEvent: 'inviteCreated', map: (data) => mapApplicationEvent(InviteEvents.InviteCreated, data), pluginId: 'core-compat' },
        { applicationEvent: InviteEvents.InviteDeleted, socketEvent: 'inviteDeleted', map: (data) => mapApplicationEvent(InviteEvents.InviteDeleted, data), pluginId: 'core-compat' },
        { applicationEvent: InviteEvents.LabelUpdated, socketEvent: 'inviteLabelUpdated', map: (data) => mapApplicationEvent(InviteEvents.LabelUpdated, data), pluginId: 'core-compat' },
        { applicationEvent: SafetyEvents.AutoModExecution, socketEvent: 'autoModExecution', map: (data) => mapApplicationEvent(SafetyEvents.AutoModExecution, data), pluginId: 'core-compat' },
        { applicationEvent: SafetyEvents.AutoModRuleUpdated, socketEvent: 'autoModRuleUpdated', map: (data) => mapApplicationEvent(SafetyEvents.AutoModRuleUpdated, data), pluginId: 'core-compat' },
        { applicationEvent: HoneypotEvents.Triggered, socketEvent: 'honeypotTriggered', map: (data) => mapApplicationEvent(HoneypotEvents.Triggered, data), pluginId: 'core-compat' },
        { applicationEvent: GlobalBanEvents.Enforcement, socketEvent: 'globalBanEnforcement', map: (data) => mapApplicationEvent(GlobalBanEvents.Enforcement, data), pluginId: 'core-compat' },
        { applicationEvent: GlobalBanEvents.SettingsUpdated, socketEvent: 'globalBanSettingsUpdated', map: (data) => mapApplicationEvent(GlobalBanEvents.SettingsUpdated, data), pluginId: 'core-compat' },
      ];

    this.forwarders = new Map(mappings.map((mapping) => [mapping.applicationEvent, mapping.socketEvent]));
    for (const mapping of mappings) {
      const listener = (data) => this.#forwardGuildEvent(mapping, data);
      this.eventBus.on(mapping.applicationEvent, listener);
      this.subscriptions.push({ event: mapping.applicationEvent, listener, pluginId: mapping.pluginId });
    }

    this.#wireConnections();
  }

  #wireConnections() {
    this.io.on('connection', (socket) => {
      this.trackedSockets.add(socket);
      const sid = socket.request?.sessionID;
      if (sid) {
        const sockets = this.sessionSockets.get(sid) || new Set();
        sockets.add(socket);
        this.sessionSockets.set(sid, sockets);
        socket.once?.('disconnect', () => {
          this.trackedSockets.delete(socket);
          sockets.delete(socket);
          if (sockets.size === 0) this.sessionSockets.delete(sid);
        });
      }
      socket.on('joinGuild', (guildId, ack) => this.#joinGuild(socket, guildId, ack));
      socket.on('leaveGuild', (guildId, ack) => this.#leaveGuild(socket, guildId, ack));
    });
  }

  #respond(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  async #joinGuild(socket, guildId, ack) {
    const session = await this.#loadSession(socket);
    const user = session?.user;
    if (!user) {
      this.logger.warn('realtime', 'joinGuild', 'Unauthenticated socket rejected', { guildId });
      return this.#respond(ack, { success: false, error: 'UNAUTHORIZED' });
    }
    try {
      const allowed = await this.guildAccess.canViewGuild(session, guildId);
      if (!allowed) {
        this.logger.warn('realtime', 'joinGuild', 'Unauthorized guild room access denied', { guildId, userId: user.id });
        return this.#respond(ack, { success: false, error: 'FORBIDDEN' });
      }
      if (!(await this.#sessionIsActive(socket))) return this.#rejectSession(socket, ack);
      await this.#persistSession(socket, session);
      socket.join(guildRoom(guildId));
      const grants = this.grants.get(socket) || new Map();
      grants.set(guildId, Date.now());
      this.grants.set(socket, grants);
      this.#respond(ack, { success: true });
    } catch (err) {
      // A revoked/invalid OAuth authorization must re-authenticate, not be
      // denied as if the guild were forbidden, without hiding an auth failure.
      if (err instanceof UnauthorizedError) {
        return this.#respond(ack, { success: false, error: 'UNAUTHORIZED' });
      }
      this.#respond(ack, { success: false, error: 'FORBIDDEN' });
    }
  }

  #leaveGuild(socket, guildId, ack) {
    socket.leave(guildRoom(guildId));
    this.#respond(ack, { success: true });
  }

  #forwardGuildEvent(mapping, data) {
    const guildId = mapping.getGuildId ? mapping.getGuildId(data) : data?.guildId;
    if (!data || !guildId) return;
    const forward = async () => {
      if (mapping.pluginId !== 'core-compat' && this.pluginSettings && !this.pluginSettings.isEnabled(guildId, mapping.pluginId)) return;
      const payload = mapping.map(data);
      const room = this.io.sockets?.adapter?.rooms?.get(guildRoom(guildId)) || new Set();
      await Promise.all([...room].map(async (socketId) => {
        const socket = this.io.sockets?.sockets?.get(socketId);
        if (!socket || !(await this.#socketMayView(socket, guildId))) return;
        socket.emit(mapping.socketEvent, payload);
      }));
    };
    forward().catch((error) => {
      this.logger.error?.('realtime', mapping.pluginId, 'Realtime mapping failed', { error });
    });
  }

  stop() {
    for (const subscription of this.subscriptions.splice(0)) {
      this.eventBus.off?.(subscription.event, subscription.listener);
    }
    this.sessionSockets.clear();
    if (this.grantTimer) clearInterval(this.grantTimer);
    this.grantTimer = null;
    this.trackedSockets.clear();
  }

  async #loadSession(socket) {
    const sid = socket.request?.sessionID;
    if (!this.sessionStore?.get) return socket.request?.session || null;
    if (!sid) return null;
    return new Promise((resolve) => this.sessionStore.get(sid, (_error, value) => resolve(value)));
  }

  async #sessionIsActive(socket) {
    const sid = socket.request?.sessionID;
    if (!sid || !this.sessionStore) return Boolean(socket.request?.session?.user);
    if (typeof this.sessionStore.isActive === 'function') {
      return await new Promise((resolve) => this.sessionStore.isActive(sid, (_error, active) => resolve(Boolean(active))));
    }
    return Boolean(await this.#loadSession(socket));
  }

  async #persistSession(socket, session) {
    const sid = socket.request?.sessionID;
    if (!session) return;
    if (!this.sessionStore?.set) {
      if (typeof session.save === 'function') {
        await new Promise((resolve, reject) => session.save((error) => error ? reject(error) : resolve()));
      }
      return;
    }
    if (!sid) return;
    if (typeof this.sessionStore.setIfActive === 'function') {
      await new Promise((resolve, reject) => this.sessionStore.setIfActive(sid, session, (error) => error ? reject(error) : resolve()));
      return;
    }
    // Legacy/custom stores are only allowed when the session is still active;
    // this check prevents the logout resurrection in the built-in store.
    if (!(await this.#sessionIsActive(socket))) throw new UnauthorizedError('Session expired.');
    await new Promise((resolve, reject) => this.sessionStore.set(sid, session, (error) => error ? reject(error) : resolve()));
  }

  async #socketMayView(socket, guildId) {
    const session = await this.#loadSession(socket);
    if (!session?.user || !(await this.#sessionIsActive(socket))) {
      socket.leave?.(guildRoom(guildId));
      socket.disconnect?.(true);
      return false;
    }
    const grants = this.grants.get(socket) || new Map();
    const checkedAt = grants.get(guildId) || 0;
    const ttlMs = Math.max(1000, Math.min(Number(this.guildAccess?.permissionService?.ttlSeconds || 10) * 1000, 10000));
    if (Date.now() - checkedAt < ttlMs) return true;
    try {
      const allowed = await this.guildAccess.canViewGuild(session, guildId);
      if (!allowed) {
        socket.leave?.(guildRoom(guildId));
        return false;
      }
      grants.set(guildId, Date.now());
      this.grants.set(socket, grants);
      await this.#persistSession(socket, session);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedError) socket.disconnect?.(true);
      else socket.leave?.(guildRoom(guildId));
      return false;
    }
  }

  #rejectSession(socket, ack) {
    socket.disconnect?.(true);
    return this.#respond(ack, { success: false, error: 'UNAUTHORIZED' });
  }

  invalidateSession(sid) {
    const sockets = this.sessionSockets.get(sid);
    for (const socket of sockets || []) socket.disconnect?.(true);
    this.sessionSockets.delete(sid);
  }
}

module.exports = { SocketGateway, guildRoom };
