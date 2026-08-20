const { mapDiscordInvite } = require('../mappers');

module.exports = {
  name: 'inviteDelete',
  execute(invite, client) {
    const services = client.services;
    if (!services) return;
    services.invites.handleInviteDeleted(mapDiscordInvite(invite));
  }
};
