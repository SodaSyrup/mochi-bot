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

// Feature-scoped application events. Each feature owns its namespace; the
// invites namespace does not contain safety events and vice versa. Feature
// services publish these after successful state transitions; infrastructure
// (Socket gateway, future webhooks/logging) subscribes.
const InviteEvents = Object.freeze({
  MemberJoined: 'invites.memberJoined',
  MemberLeft: 'invites.memberLeft',
  InviteCreated: 'invites.inviteCreated',
  InviteDeleted: 'invites.inviteDeleted',
  LabelUpdated: 'invites.labelUpdated',
});

const SafetyEvents = Object.freeze({
  AutoModExecution: 'safety.autoModExecution',
  AutoModRuleUpdated: 'safety.autoModRuleUpdated',
});

module.exports = { createEventBus, InviteEvents, SafetyEvents };
