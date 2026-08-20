const { EventEmitter } = require('events');

/**
 * Application event bus. Feature services publish canonical, serializable
 * application events here after successful state transitions. Infrastructure
 * (Socket.IO gateway, future logging/analytics/webhooks) subscribes here.
 *
 * This keeps feature services unaware of the dashboard.
 */
function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);
  return emitter;
}

const InviteEvents = Object.freeze({
  MemberJoined: 'invites.memberJoined',
  MemberLeft: 'invites.memberLeft',
  InviteCreated: 'invites.inviteCreated',
  InviteDeleted: 'invites.inviteDeleted',
  LabelUpdated: 'invites.labelUpdated',
  AutoModExecution: 'automod.execution',
  AutoModRuleUpdated: 'automod.ruleUpdated',
});

module.exports = { createEventBus, InviteEvents };
