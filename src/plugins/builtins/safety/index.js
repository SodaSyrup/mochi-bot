const actionExecution = require('../../../bot/events/autoModerationActionExecution');
const ruleCreate = require('../../../bot/events/autoModerationRuleCreate');
const ruleDelete = require('../../../bot/events/autoModerationRuleDelete');
const ruleUpdate = require('../../../bot/events/autoModerationRuleUpdate');

module.exports = {
  manifest: {
    id: 'safety',
    name: 'Safety',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Discord AutoMod event handling and dashboard controls.',
    requires: [],
  },
  migrations: [],
  register(context) {
    const services = context.baseServices;
    context.services.register('safety', services.safety);
    context.services.register('safetyGateway', services.safetyGateway);
    for (const handler of [actionExecution, ruleCreate, ruleDelete, ruleUpdate]) {
      context.discordEvents.register(handler, { source: `src/bot/events/${handler.name}.js` });
    }
    context.dashboardApi.register({
      id: 'safety-api',
      mountPath: '/guilds/:guildId/safety',
      scope: 'guild-manage',
      install(router) {
        router.use(require('../../../dashboard/routes/safetyRoutes').createSafetyRoutes({ safetyService: services.safety }));
      },
    });
    context.pages.register({ id: 'safety', path: '/safety', file: 'safety.html' });

    const { SafetyEvents } = require('../../../app/eventBus');
    const mappers = require('../../../dashboard/realtime/eventMappers');
    context.realtime.register({ id: 'safety-automod-execution', applicationEvent: SafetyEvents.AutoModExecution, socketEvent: 'autoModExecution', map: mappers.mapAutoModExecutionEvent });
    context.realtime.register({ id: 'safety-rule-updated', applicationEvent: SafetyEvents.AutoModRuleUpdated, socketEvent: 'autoModRuleUpdated', map: mappers.mapRuleUpdatedEvent });
  },
};
