module.exports = {
  name: 'guildDelete',
  async execute(guild, client) {
    const services = client.services;
    if (!services) return;
    console.log(`[Bot] Left guild: ${guild.name} (${guild.id})`);
    services.invites.forgetGuild(guild.id);
  }
};
