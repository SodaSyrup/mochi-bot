const { EmbedBuilder } = require('discord.js');
const config = require('../../config');
const { BOT_COLORS } = require('../theme');

class MochiEmbedBuilder {
  /**
   * Base template with Mochi styling
   */
  base(options = {}) {
    const embed = new EmbedBuilder()
      .setColor(options.color || config.bot.embedColor)
      .setTimestamp();

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(options.description);
    if (options.footer) {
      embed.setFooter({
        text: options.footer.text || 'Mochi 🍡 • Invite Tracker',
        iconURL: options.footer.iconURL
      });
    } else {
      embed.setFooter({ text: 'Mochi 🍡 • Invite Tracker' });
    }

    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);
    if (options.fields) embed.addFields(options.fields);

    return embed;
  }

  success(title, description) {
    return this.base({
      color: BOT_COLORS.success,
      title: `✅ ${title}`,
      description
    });
  }

  error(title, description) {
    return this.base({
      color: BOT_COLORS.error,
      title: `❌ ${title}`,
      description
    });
  }

  warn(title, description) {
    return this.base({
      color: BOT_COLORS.warning,
      title: `⚠️ ${title}`,
      description
    });
  }

  info(title, description) {
    return this.base({
      color: BOT_COLORS.info,
      title: `ℹ️ ${title}`,
      description
    });
  }

  invites(user, stats, guildName) {
    const net = stats.regular + stats.bonus - stats.leaves - stats.fake;
    return this.base({
      title: `📊 Invite Statistics for ${user.username}`,
      thumbnail: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
      description: `Server: **${guildName}**\n\nTotal Net Invites: **${net}** 🎯`,
      fields: [
        { name: '✅ Regular', value: `\`${stats.regular}\``, inline: true },
        { name: '➕ Bonus', value: `\`${stats.bonus || 0}\``, inline: true },
        { name: '🚪 Leaves', value: `\`${stats.leaves}\``, inline: true },
        { name: '🤖 Fake / Suspicious', value: `\`${stats.fake}\``, inline: true }
      ]
    });
  }
}

module.exports = new MochiEmbedBuilder();
