module.exports = {
  name: 'guildCreate',
  async execute(guild, client) {
    const services = client.services;
    if (!services) return;
    console.log(`[Bot] Joined new guild: ${guild.name} (${guild.id})`);
    await services.invites.initializeGuild(guild.id);
  }
};
