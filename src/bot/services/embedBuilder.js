const { EmbedBuilder } = require('discord.js');
const config = require('../../config');

class MochiEmbedBuilder {
  /**
   * Base template with Mochi styling
   */
  base(options = {}) {
    const embed = new EmbedBuilder()
      .setColor(options.color || config.bot.embedColor || '#7c3aed')
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
      color: '#10b981',
      title: `✅ ${title}`,
      description
    });
  }

  error(title, description) {
    return this.base({
      color: '#ef4444',
      title: `❌ ${title}`,
      description
    });
  }

  warn(title, description) {
    return this.base({
      color: '#f59e0b',
      title: `⚠️ ${title}`,
      description
    });
  }

  info(title, description) {
    return this.base({
      color: '#3b82f6',
      title: `ℹ️ ${title}`,
      description
    });
  }

  invites(user, stats, guildName) {
    const net = stats.regular - stats.leaves - stats.fake;
    return this.base({
      title: `📊 Invite Statistics for ${user.username}`,
      thumbnail: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
      description: `Server: **${guildName}**\n\nTotal Net Invites: **${net}** 🎯`,
      fields: [
        { name: '✅ Regular', value: `\`${stats.regular}\``, inline: true },
        { name: '🚪 Leaves', value: `\`${stats.leaves}\``, inline: true },
        { name: '🤖 Fake / Suspicious', value: `\`${stats.fake}\``, inline: true }
      ]
    });
  }
}

module.exports = new MochiEmbedBuilder();
