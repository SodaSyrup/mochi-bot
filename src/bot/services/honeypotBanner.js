const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  resolveColor,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { BOT_COLORS } = require('../theme');

function normalizeKicks(kicks) {
  const value = Number(kicks);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Build the persistent honeypot banner using Discord Components V2.
 *
 * Components V2 messages cannot contain content or embeds, so this function
 * returns the complete message payload rather than just a visual component.
 */
function buildHoneypotBanner({ kicks = 0, thumbnailUrl = null } = {}) {
  const count = normalizeKicks(kicks);
  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## DO NOT SEND MESSAGES IN THIS CHANNEL'),
    new TextDisplayBuilder().setContent(
      'This channel is used to catch spam bots. Any messages sent here will result in a **softban**.'
    )
  );

  if (thumbnailUrl) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder().setURL(String(thumbnailUrl)).setDescription('Honeypot')
    );
  }

  const counter = new ButtonBuilder()
    .setCustomId('honeypot:kicks-counter')
    .setEmoji('🍯')
    .setLabel(`Kicks: ${count}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const container = new ContainerBuilder()
    .setAccentColor(resolveColor(BOT_COLORS.honeypot))
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(counter));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = { buildHoneypotBanner, normalizeKicks };
