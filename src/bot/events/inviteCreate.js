const inviteTracker = require('../services/inviteTracker');

module.exports = {
  name: 'inviteCreate',
  execute(invite) {
    inviteTracker.handleInviteCreate(invite);
  }
};
