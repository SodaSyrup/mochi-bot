const { InviteEvents, SafetyEvents } = require('../../app/eventBus');
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
  constructor({ io, eventBus, guildAccess, logger }) {
    this.io = io;
    this.eventBus = eventBus;
    this.guildAccess = guildAccess;
    this.logger = logger || console;

    // application event -> socket event name
    this.forwarders = new Map([
      [InviteEvents.MemberJoined, 'memberJoin'],
      [InviteEvents.MemberLeft, 'memberLeave'],
      [InviteEvents.InviteCreated, 'inviteCreated'],
      [InviteEvents.InviteDeleted, 'inviteDeleted'],
      [InviteEvents.LabelUpdated, 'inviteLabelUpdated'],
      [SafetyEvents.AutoModExecution, 'autoModExecution'],
      [SafetyEvents.AutoModRuleUpdated, 'autoModRuleUpdated'],
    ]);

    for (const [appEvent, socketEvent] of this.forwarders) {
      this.eventBus.on(appEvent, (data) => this.#forwardGuildEvent(appEvent, socketEvent, data));
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

  #forwardGuildEvent(appEvent, socketEvent, data) {
    if (!data || !data.guildId) return;
    const payload = mapApplicationEvent(appEvent, data);
    this.io.to(guildRoom(data.guildId)).emit(socketEvent, payload);
  }
}

module.exports = { SocketGateway, guildRoom };
