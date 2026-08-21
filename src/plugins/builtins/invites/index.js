const inviteCodes = require('../../../bot/commands/invites/inviteCodes');
const inviteLabel = require('../../../bot/commands/invites/inviteLabel');
const invitesCommand = require('../../../bot/commands/invites/invites');
const leaderboard = require('../../../bot/commands/invites/leaderboard');
const inviteCreate = require('../../../bot/events/inviteCreate');
const inviteDelete = require('../../../bot/events/inviteDelete');
const { mapDiscordMember } = require('../../../bot/mappers');

const commands = [inviteCodes, inviteLabel, invitesCommand, leaderboard];

function humanMemberHandler(name, operation) {
  return {
    name,
    async execute(member, client) {
      const services = client.services;
      if (!services) return;
      const memberData = mapDiscordMember(member);
      if (!memberData.guildId || memberData.bot) return;
      if (!services.policy.shouldTrackMember(memberData)) return;
      await services.invites[operation](memberData);
    },
  };
}

module.exports = {
  manifest: {
    id: 'invites',
    name: 'Invite Tracking',
    version: '1.0.0',
    apiVersion: 1,
    description: 'Tracks invite attribution and invite statistics.',
    requires: [],
  },
  migrations: [],
  register(context) {
    const services = context.baseServices;
    for (const command of commands) {
      context.commands.register(command, { source: `src/bot/commands/invites/${command.data.name}.js` });
    }
    context.services.register('invites', services.invites);
    context.services.register('inviteRepository', services.inviteRepository);
    context.services.register('inviteGateway', services.inviteGateway);
    context.services.register('policy', services.policy);

    context.discordEvents.register(inviteCreate, { source: 'src/bot/events/inviteCreate.js' });
    context.discordEvents.register(inviteDelete, { source: 'src/bot/events/inviteDelete.js' });
    context.discordEvents.register(humanMemberHandler('guildMemberAdd', 'trackMemberJoin'), { source: 'src/bot/events/guildMemberAdd.js' });
    context.discordEvents.register(humanMemberHandler('guildMemberRemove', 'trackMemberLeave'), { source: 'src/bot/events/guildMemberRemove.js' });

    context.dashboardApi.register({
      id: 'invites-api',
      mountPath: '/guilds/:guildId/invites',
      scope: 'guild-manage',
      install(router) {
        router.use(require('../../../dashboard/routes/inviteRoutes').createInviteRoutes({
          inviteService: services.invites,
          pagination: context.config.limits.pagination,
        }));
      },
    });

    context.pages.register({ id: 'analytics', path: '/analytics', file: 'analytics.html' });
    context.pages.register({ id: 'leaderboard', path: '/leaderboard', file: 'leaderboard.html' });
    context.pages.register({ id: 'codes', path: '/codes', file: 'codes.html' });

    const mappers = require('../../../dashboard/realtime/eventMappers');
    const { InviteEvents } = require('../../../app/eventBus');
    const mappings = [
      ['invite-member-joined', InviteEvents.MemberJoined, 'memberJoin', mappers.mapMemberEvent],
      ['invite-member-left', InviteEvents.MemberLeft, 'memberLeave', mappers.mapMemberEvent],
      ['invite-created', InviteEvents.InviteCreated, 'inviteCreated', mappers.mapInviteCreatedEvent],
      ['invite-deleted', InviteEvents.InviteDeleted, 'inviteDeleted', mappers.mapInviteDeletedEvent],
      ['invite-label-updated', InviteEvents.LabelUpdated, 'inviteLabelUpdated', mappers.mapLabelUpdatedEvent],
    ];
    for (const [id, applicationEvent, socketEvent, map] of mappings) {
      context.realtime.register({ id, applicationEvent, socketEvent, map });
    }
  },
};
