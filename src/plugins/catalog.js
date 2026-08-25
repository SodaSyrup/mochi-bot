const utility = require('./builtins/utility');
const invites = require('./builtins/invites');
const inviteLogs = require('./builtins/invite-logs');
const safety = require('./builtins/safety');
const honeypot = require('./builtins/honeypot');
const permissionGroups = require('./builtins/permission-groups');
const globalBans = require('./builtins/global-bans');

module.exports = Object.freeze([
  utility,
  invites,
  inviteLogs,
  safety,
  honeypot,
  permissionGroups,
  globalBans,
]);
