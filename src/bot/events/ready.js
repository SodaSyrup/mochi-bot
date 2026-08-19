const { ActivityType } = require('discord.js');
const inviteTracker = require('../services/inviteTracker');
const guildRepo = require('../../database/repositories/guildRepo');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[Bot] Logged in as ${client.user.tag} (ID: ${client.user.id})`);

    // Set rotating activity presence
    const updatePresence = () => {
      const serverCount = client.guilds.cache.size;
      const memberCount = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
      client.user.setPresence({
        activities: [
          {
            name: `${serverCount} servers • ${memberCount} members | /help 🍡`,
            type: ActivityType.Watching
          }
        ],
        status: 'online'
      });
    };

    updatePresence();
    setInterval(updatePresence, 60000);

    // Initialize invite cache and sync database for all guilds
    console.log(`[Bot] Initializing invite cache for ${client.guilds.cache.size} guilds...`);
    for (const [, guild] of client.guilds.cache) {
      guildRepo.getGuild(guild.id, guild.name, guild.iconURL());
      await inviteTracker.initGuild(guild);
    }

    console.log('[Bot] Mochi is fully initialized and ready!');
  }
};
