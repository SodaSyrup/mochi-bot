const { ActivityType } = require('discord.js');
const config = require('../../config');

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
    client.mochiPresenceInterval = setInterval(updatePresence, config.operations.presenceIntervalMs);
    client.mochiPresenceInterval.unref?.();

    if (!services.invites) return;
    console.log(`[Bot] Initializing invite cache for ${client.guilds.cache.size} guilds...`);
    const guilds = [...client.guilds.cache.values()];
    const runBounded = async (operation, concurrency) => {
      const failures = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < guilds.length) {
          const guild = guilds[cursor++];
          try {
            if (!services.pluginSettings || services.pluginSettings.isEnabled(guild.id, 'invites')) {
              await operation(guild.id);
            }
          } catch (error) {
            failures.push({ guildId: guild.id, error });
            services.logger?.error?.('bot', 'guildInitialization', `Failed to initialize guild ${guild.id}`, {
              guildId: guild.id,
              error,
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, guilds.length) }, () => worker()));
      return failures;
    };

    const primeFailures = await runBounded((guildId) => services.invites.primeGuildInvites(guildId), config.operations.guildInviteInitConcurrency);
    const reconcileFailures = await runBounded((guildId) => services.invites.reconcileGuildMembers(guildId), config.operations.guildMemberReconcileConcurrency);
    const failures = [...primeFailures, ...reconcileFailures];
    if (failures.length > 0) {
      console.warn(`[Bot] Invite initialization completed with ${failures.length} guild failure(s).`);
    }
    console.log('[Bot] Mochi is fully initialized and ready!');
  }
};
