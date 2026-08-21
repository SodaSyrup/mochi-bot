module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (!client.services?.honeypot) return;
    if (!message.guildId) return;
    // Mochi's own warning banner also produces messageCreate. Other bot
    // accounts must still trigger the honeypot because spam bots are the
    // primary target of this feature.
    if (message.author?.id && message.author.id === client.user?.id) return;
    await client.services.honeypot.handleMessage(message);
  },
};
