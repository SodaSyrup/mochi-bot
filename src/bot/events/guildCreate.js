module.exports = {
  name: 'guildCreate',
  async execute(guild, client) {
    const services = client.services;
    if (!services) return;
    console.log(`[Bot] Joined new guild: ${guild.name} (${guild.id})`);
    if (services.invites && (!services.pluginSettings || services.pluginSettings.isEnabled(guild.id, 'invites'))) {
      await services.invites.initializeGuild(guild.id);
    }
  }
};
