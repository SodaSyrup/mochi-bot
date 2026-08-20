const { InviteEvents } = require('../../app/eventBus');

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
      [InviteEvents.AutoModExecution, 'autoModExecution'],
      [InviteEvents.AutoModRuleUpdated, 'autoModRuleUpdated'],
    ]);

    for (const [appEvent, socketEvent] of this.forwarders) {
      this.eventBus.on(appEvent, (data) => this.#forwardGuildEvent(socketEvent, data));
    }

    this.#wireConnections();
  }

  #wireConnections() {
    this.io.on('connection', (socket) => {
      socket.on('joinGuild', (guildId, ack) => this.#joinGuild(socket, guildId, ack));
      socket.on('leaveGuild', (guildId, ack) => this.#leaveGuild(socket, guildId, ack));
    });
  }

  #sessionUser(socket) {
    return socket.request?.session?.user || null;
  }

  #respond(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  async #joinGuild(socket, guildId, ack) {
    const user = this.#sessionUser(socket);
    if (!user) {
      this.logger.warn('realtime', 'joinGuild', 'Unauthenticated socket rejected', { guildId });
      return this.#respond(ack, { success: false, error: 'UNAUTHORIZED' });
    }
    try {
      const allowed = await this.guildAccess.canViewGuild(user, guildId);
      if (!allowed) {
        this.logger.warn('realtime', 'joinGuild', 'Unauthorized guild room access denied', { guildId, userId: user.id });
        return this.#respond(ack, { success: false, error: 'FORBIDDEN' });
      }
      socket.join(guildRoom(guildId));
      this.#respond(ack, { success: true });
    } catch (err) {
      this.#respond(ack, { success: false, error: 'FORBIDDEN' });
    }
  }

  #leaveGuild(socket, guildId, ack) {
    socket.leave(guildRoom(guildId));
    this.#respond(ack, { success: true });
  }

  #forwardGuildEvent(socketEvent, data) {
    if (!data || !data.guildId) return;
    this.io.to(guildRoom(data.guildId)).emit(socketEvent, data);
  }
}

module.exports = { SocketGateway, guildRoom };
