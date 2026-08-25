const utility = require('./builtins/utility');
const invites = require('./builtins/invites');
const inviteLogs = require('./builtins/invite-logs');
const safety = require('./builtins/safety');
const honeypot = require('./builtins/honeypot');
const permissionGroups = require('./builtins/permission-groups');
const globalBans = require('./builtins/global-bans');

/** Built-in plugins are a default catalog; external catalogs can be supplied to the application composition root. */
module.exports = Object.freeze([utility, invites, inviteLogs, safety, honeypot, permissionGroups, globalBans]);

