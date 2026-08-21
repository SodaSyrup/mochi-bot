const { InviteEvents, SafetyEvents, HoneypotEvents } = require('../../app/eventBus');
const { mapApplicationEvent } = require('./eventMappers');
const { UnauthorizedError } = require('../errors');

/**
 * One helper constructs room names so authorization and emission never drift.
 */
function guildRoom(guildId) {
  return `guild_${guildId}`;
}

/**
 * Socket.IO gateway. Subscribes to canonical application events and forwards
 * guild-scoped payloads exclusively to the authorized guild room. No global
 * broadcasts. Session identity (never client-supplied) drives authorization.
 */
class SocketGateway {
  constructor({ io, eventBus, guildAccess, logger, contributions = null, pluginSettings = null }) {
    this.io = io;
    this.eventBus = eventBus;
    this.guildAccess = guildAccess;
    this.logger = logger || console;
    this.pluginSettings = pluginSettings;

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
      socket.on('joinGuild', (guildId, ack) => this.#joinGuild(socket, guildId, ack));
      socket.on('leaveGuild', (guildId, ack) => this.#leaveGuild(socket, guildId, ack));
    });
  }

  #respond(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  async #joinGuild(socket, guildId, ack) {
    const session = socket.request?.session;
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
      // canViewGuild may have refreshed OAuth credentials / the guild permission
      // snapshot on the socket's session. The socket handshake response already
      // ended, so express-session will NOT save it automatically — persist it
      // explicitly or the refreshed material is lost.
      if (typeof session?.save === 'function') {
        await new Promise((resolve, reject) => {
          session.save((err) => (err ? reject(err) : resolve()));
        });
      }
      socket.join(guildRoom(guildId));
      this.#respond(ack, { success: true });
    } catch (err) {
      // A revoked/invalid OAuth authorization must re-authenticate, not be
      // silently denied as if the guild were simply forbidden.
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
      this.io.to(guildRoom(guildId)).emit(mapping.socketEvent, payload);
    };
    forward().catch((error) => {
      this.logger.error?.('realtime', mapping.pluginId, 'Realtime mapping failed', { error });
    });
  }

  stop() {
    for (const subscription of this.subscriptions.splice(0)) {
      this.eventBus.off?.(subscription.event, subscription.listener);
    }
  }
}

module.exports = { SocketGateway, guildRoom };
