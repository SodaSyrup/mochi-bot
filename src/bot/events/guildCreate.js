const inviteTracker = require('../services/inviteTracker');
const guildRepo = require('../../database/repositories/guildRepo');

module.exports = {
  name: 'guildCreate',
  async execute(guild, client) {
    console.log(`[Bot] Joined new guild: ${guild.name} (${guild.id})`);
    guildRepo.getGuild(guild.id, guild.name, guild.iconURL());
    await inviteTracker.initGuild(guild);
  }
};
