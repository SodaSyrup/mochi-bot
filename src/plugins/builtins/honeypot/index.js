const honeypotCommand = require('../../../bot/commands/moderation/honeypot');

const messageCreate = {
  name: 'messageCreate',
  async execute(message, client) {
    if (!client.services?.honeypot || !message.guildId) return;
    if (message.author?.id && message.author.id === client.user?.id) return;
    await client.services.honeypot.handleMessage(message);
  },
};

module.exports = {
  manifest: {
    id: 'honeypot',
    name: 'Honeypot Moderation',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Soft-ban honeypot moderation and its dashboard.',
    requires: [],
  },
  migrations: [],
  register(context) {
    const services = context.baseServices;
    context.commands.register(honeypotCommand, { source: 'src/bot/commands/moderation/honeypot.js' });
    context.services.register('honeypot', services.honeypot);
    context.services.register('honeypotRepository', services.honeypotRepository);
    context.services.register('honeypotGateway', services.honeypotGateway);
    context.discordEvents.register(messageCreate, { source: 'src/bot/events/messageCreate.js' });
    context.dashboardApi.register({
      id: 'honeypot-api',
      mountPath: '/guilds/:guildId/honeypot',
      scope: 'guild-manage',
      install(router) {
        router.use(require('../../../dashboard/routes/honeypotRoutes').createHoneypotRoutes({
          honeypotService: services.honeypot,
          guildService: services.guilds,
        }));
      },
    });
    context.pages.register({ id: 'honeypot', path: '/honeypot', file: 'honeypot.html' });

    const { HoneypotEvents } = require('../../../app/eventBus');
    const { mapHoneypotTriggeredEvent } = require('../../../dashboard/realtime/eventMappers');
    context.realtime.register({ id: 'honeypot-triggered', applicationEvent: HoneypotEvents.Triggered, socketEvent: 'honeypotTriggered', map: mapHoneypotTriggeredEvent });
  },
};
