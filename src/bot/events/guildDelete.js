const inviteTracker = require('../services/inviteTracker');

module.exports = {
  name: 'guildDelete',
  async execute(guild, client) {
    console.log(`[Bot] Left guild: ${guild.name} (${guild.id})`);
    inviteTracker.invitesCache.delete(guild.id);
    inviteTracker.vanityCache.delete(guild.id);
  }
};
