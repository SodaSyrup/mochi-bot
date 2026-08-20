const { mapDiscordInvite } = require('../mappers');

module.exports = {
  name: 'inviteCreate',
  execute(invite, client) {
    const services = client.services;
    if (!services) return;
    services.invites.handleInviteCreated(mapDiscordInvite(invite));
  }
};
