const inviteTracker = require('../services/inviteTracker');

module.exports = {
  name: 'inviteDelete',
  execute(invite) {
    inviteTracker.handleInviteDelete(invite);
  }
};
