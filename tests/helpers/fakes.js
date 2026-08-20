const { EventEmitter } = require('events');

/**
 * Fake clock for deterministic policy tests.
 */
function createFakeClock(nowMs) {
  let current = nowMs;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
    set(ms) {
      current = ms;
    },
  };
}

/**
 * Recording event bus — wraps an EventEmitter and records every published
 * application event for assertions.
 */
function createRecordingBus() {
  const emitter = new EventEmitter();
  const recorded = [];
  emitter.onAny = emitter.on;
  emitter.on('__record__', () => {});
  const wrapped = {
    emitter,
    recorded,
    on(event, fn) {
      emitter.on(event, fn);
      return this;
    },
    emit(event, payload) {
      recorded.push({ event, payload });
      return emitter.emit(event, payload);
    },
  };
  return wrapped;
}

/**
 * Fake invite gateway with manually controlled snapshots.
 */
function createFakeInviteGateway(initial = {}) {
  const state = {
    invites: new Map(),
    vanityUses: 0,
    fetchGuildInvitesResult: null, // set to override
    fetchGuildInvitesError: null,
    fetchGuildMembersResult: null,
  };

  for (const inv of initial.invites || []) {
    state.invites.set(inv.code, inv);
  }
  if (initial.vanityUses != null) state.vanityUses = initial.vanityUses;

  return {
    state,
    async fetchGuildInvites(guildId) {
      if (state.fetchGuildInvitesError) throw state.fetchGuildInvitesError;
      if (state.fetchGuildInvitesResult) return state.fetchGuildInvitesResult;
      return { invites: Array.from(state.invites.values()), vanityUses: state.vanityUses };
    },
    async fetchGuildMembers(guildId) {
      return state.fetchGuildMembersResult || [];
    },
    async createInvite() {
      throw new Error('Not implemented in fake');
    },
    async deleteInvite() {
      throw new Error('Not implemented in fake');
    },
    async resolveUser(userId) {
      return initial.users?.[userId] || null;
    },
  };
}

/**
 * Fake guild access service.
 */
function createFakeGuildAccess({ manageable = [] } = {}) {
  return {
    manageable,
    async listManageableGuilds() {
      return this.manageable;
    },
    async canViewGuild(user, guildId) {
      return this.manageable.some((g) => g.id === guildId);
    },
    async canManageGuild(user, guildId) {
      return this.manageable.some((g) => g.id === guildId);
    },
  };
}

/**
 * Build a plain member DTO for a join event.
 */
function makeMember({ id, guildId, username, bot = false, joinedAt, accountCreatedAt }) {
  return {
    id,
    guildId,
    username: username || `User_${id}`,
    avatar: null,
    bot,
    joinedAt: joinedAt || new Date().toISOString(),
    accountCreatedAt: accountCreatedAt || new Date(Date.now() - 365 * 86400000).toISOString(),
  };
}

module.exports = {
  createFakeClock,
  createRecordingBus,
  createFakeInviteGateway,
  createFakeGuildAccess,
  makeMember,
};
