/**
 * Demo invite log gateway — in-memory stand-in used only in APP_MODE=demo.
 *
 * Records "sent" messages so the invite-logs feature can be exercised end-to-end
 * without touching a real Discord client. Bot-adder resolution has no audit log
 * to query, so it always returns null.
 */
class DemoInviteLogGateway {
  constructor() {
    this.sent = [];
  }

  async sendMessage(guildId, channelId, content) {
    this.sent.push({ guildId, channelId, content });
    return true;
  }

  async findRecentBotAdder() {
    return null;
  }
}

module.exports = { DemoInviteLogGateway };

