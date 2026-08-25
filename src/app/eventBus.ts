const { EventEmitter } = require('events');
const { DEFAULTS } = require('../config/defaults');

export function createEventBus(): any {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(DEFAULTS.operations.eventBusMaxListeners);
  return emitter;
}

export const InviteEvents = Object.freeze({
  MemberJoined: 'invites.memberJoined', MemberLeft: 'invites.memberLeft', InviteCreated: 'invites.inviteCreated', InviteDeleted: 'invites.inviteDeleted', LabelUpdated: 'invites.labelUpdated',
});
export const SafetyEvents = Object.freeze({ AutoModExecution: 'safety.autoModExecution', AutoModRuleUpdated: 'safety.autoModRuleUpdated' });
export const HoneypotEvents = Object.freeze({ Triggered: 'honeypot.triggered' });
export const GlobalBanEvents = Object.freeze({ SyncChanged: 'globalBans.syncChanged', Enforcement: 'globalBans.enforcement', SettingsUpdated: 'globalBans.settingsUpdated' });

