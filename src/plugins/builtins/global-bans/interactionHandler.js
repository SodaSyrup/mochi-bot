const { PermissionFlagsBits } = require('discord.js');
const { parseGlobalBanButtonId } = require('../../../bot/services/globalBanAlert');
const { OUTCOMES } = require('../../../features/globalBans/domain/outcomes');

function hasBanPermission(interaction) {
  return Boolean(interaction?.memberPermissions?.has?.(PermissionFlagsBits.BanMembers));
}

function resultMessage(userId, result) {
  switch (result?.outcome) {
    case OUTCOMES.BANNED:
      return `User ${userId} has been banned from this server.`;
    case OUTCOMES.ALREADY_BANNED:
      return `User ${userId} was already banned from this server.`;
    case OUTCOMES.NOT_LISTED:
      return 'This global-ban entry is no longer active.';
    case OUTCOMES.EXEMPT:
      return 'This user has a local exemption in this server.';
    case OUTCOMES.STALE:
      return 'The global-ban registry cache is stale. The user was not banned.';
    case OUTCOMES.POLICY_CHANGED:
    case OUTCOMES.DISABLED:
      return 'This global-ban alert is no longer actionable for this server.';
    case OUTCOMES.MISSING_PERMISSION:
      return 'Mochi needs the Ban Members permission to perform this action.';
    case OUTCOMES.GUILD_UNAVAILABLE:
      return 'The server is currently unavailable to Mochi.';
    default:
      return 'The ban could not be completed. Please check Mochi’s permissions and try again.';
  }
}

const interactionHandler = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction?.isButton?.()) return;
    const userId = parseGlobalBanButtonId(interaction.customId);
    if (!userId || !interaction.guildId) return;
    if (client.user?.id && interaction.message?.author?.id && interaction.message.author.id !== client.user.id) return;

    if (!hasBanPermission(interaction)) {
      await interaction.reply({ content: 'You need the Ban Members permission to use this button.', ephemeral: true }).catch(() => {});
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
      const service = client.services?.globalBans;
      const result = service
        ? await service.banFromAlert({ guildId: interaction.guildId, userId, moderatorId: interaction.user?.id })
        : { outcome: OUTCOMES.DISABLED };
      const successful = result.outcome === OUTCOMES.BANNED || result.outcome === OUTCOMES.ALREADY_BANNED;

      if (successful) {
        await Promise.resolve(client.services?.globalBanGateway?.markAlertBanned?.({
          message: interaction.message,
          moderatorUsername: interaction.user?.username,
          outcome: result.outcome,
        })).catch(() => {});
      }
      await interaction.editReply({ content: resultMessage(userId, result) });
    } catch (error) {
      client.services?.logger?.error?.('global-bans', 'button', 'Global-ban alert button failed.', {
        guildId: interaction.guildId,
        userId,
        errorCode: error.code || error.name,
      });
      const response = { content: 'The ban action failed unexpectedly. Please try again or check the bot permissions.' };
      if (interaction.deferred || interaction.replied) await interaction.editReply(response).catch(() => {});
      else await interaction.reply({ ...response, ephemeral: true }).catch(() => {});
    }
  },
};

module.exports = { interactionHandler, hasBanPermission, resultMessage };
