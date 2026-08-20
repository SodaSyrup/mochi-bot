const { ActivityType } = require('discord.js');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    const services = client.services;
    if (!services) return;

    console.log(`[Bot] Logged in as ${client.user.tag} (ID: ${client.user.id})`);

    const updatePresence = () => {
      const serverCount = client.guilds.cache.size;
      const memberCount = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
      client.user.setPresence({
        activities: [
          { name: `${serverCount} servers • ${memberCount} members | /help 🍡`, type: ActivityType.Watching }
        ],
        status: 'online'
      });
    };

    updatePresence();
    setInterval(updatePresence, 60000);

    console.log(`[Bot] Initializing invite cache for ${client.guilds.cache.size} guilds...`);
    for (const [, guild] of client.guilds.cache) {
      await services.invites.initializeGuild(guild.id);
    }

    console.log('[Bot] Mochi is fully initialized and ready!');
  }
};
