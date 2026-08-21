const { AutoModerationRuleTriggerType } = require('discord.js');
const { AUTO_MOD_LIMITS } = require('./autoModConstants');

/**
 * Feature-oriented adapter for Discord safety/AutoMod operations. Discord
 * payload conversion stays here; the safety service works with plain DTOs.
 */
class DiscordSafetyGateway {
  constructor({ client, logger }) {
    this.client = client;
    this.logger = logger;
  }

  #guild(guildId) {
    return this.client?.guilds?.cache?.get(guildId) || null;
  }

  formatRule(r) {
    const metadata = r.triggerMetadata || {};
    return {
      id: r.id,
      guildId: r.guildId || r.guild?.id,
      name: r.name,
      enabled: Boolean(r.enabled),
      eventType: r.eventType,
      triggerType: r.triggerType,
      triggerMetadata: {
        keywordFilter: metadata.keywordFilter || [],
        regexPatterns: metadata.regexPatterns || [],
        presets: metadata.presets || [],
        allowList: metadata.allowList || [],
        mentionTotalLimit: metadata.mentionTotalLimit || 0,
        mentionRaidProtectionEnabled: Boolean(metadata.mentionRaidProtectionEnabled),
      },
      actions: (r.actions || []).map((a) => ({
        type: a.type,
        metadata: {
          channelId: a.metadata?.channelId || null,
          durationSeconds: a.metadata?.durationSeconds || 0,
          customMessage: a.metadata?.customMessage || null,
        },
      })),
      exemptRoles: Array.isArray(r.exemptRoles) ? r.exemptRoles : Array.from(r.exemptRoles?.values?.() || []),
      exemptChannels: Array.isArray(r.exemptChannels) ? r.exemptChannels : Array.from(r.exemptChannels?.values?.() || []),
      creatorId: r.creatorId || null,
    };
  }

  #buildCreatePayload(payload) {
    const p = {
      name: payload.name.trim(),
      eventType: parseInt(payload.eventType, 10),
      triggerType: parseInt(payload.triggerType, 10),
      enabled: Boolean(payload.enabled),
      actions: (payload.actions || []).map((a) => ({
        type: parseInt(a.type, 10),
        metadata: {
          channel: a.metadata?.channelId,
          durationSeconds: a.metadata?.durationSeconds ? parseInt(a.metadata.durationSeconds, 10) : undefined,
          customMessage: a.metadata?.customMessage,
        },
      })),
      exemptRoles: payload.exemptRoles || [],
      exemptChannels: payload.exemptChannels || [],
      reason: 'Created via Mochi Safety Dashboard',
    };

    const triggerType = p.triggerType;
    const tm = payload.triggerMetadata || {};
    if (triggerType === AutoModerationRuleTriggerType.Keyword || triggerType === AutoModerationRuleTriggerType.MemberProfile) {
      p.triggerMetadata = {
        keywordFilter: tm.keywordFilter || [],
        regexPatterns: tm.regexPatterns || [],
        allowList: tm.allowList || [],
      };
    } else if (triggerType === AutoModerationRuleTriggerType.KeywordPreset) {
      p.triggerMetadata = {
        presets: (tm.presets || []).map((x) => parseInt(x, 10)),
        allowList: tm.allowList || [],
      };
    } else if (triggerType === AutoModerationRuleTriggerType.MentionSpam) {
      p.triggerMetadata = {
        mentionTotalLimit: parseInt(tm.mentionTotalLimit || AUTO_MOD_LIMITS.mentionTotalDefault, 10),
        mentionRaidProtectionEnabled: Boolean(tm.mentionRaidProtectionEnabled),
      };
    }
    return p;
  }

  async getSafetyOverview(guildId) {
    const guild = this.#guild(guildId);
    if (!guild) return null;

    let rulesCount = 0;
    let enabledRulesCount = 0;
    try {
      if (guild.autoModerationRules) {
        const rules = await guild.autoModerationRules.fetch();
        rulesCount = rules.size;
        enabledRulesCount = rules.filter((r) => r.enabled).size;
      }
    } catch (err) {
      this.logger?.warn('safety', 'getSafetyOverview', `Could not fetch AutoMod rule count for guild ${guildId}`, { guildId, error: err });
    }

    return {
      guildId: guild.id,
      guildName: guild.name,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      mfaLevel: guild.mfaLevel,
      safetyAlertsChannelId: guild.safetyAlertsChannelId || guild.publicUpdatesChannelId || guild.systemChannelId || null,
      rulesChannelId: guild.rulesChannelId || null,
      features: guild.features || [],
      rulesCount,
      enabledRulesCount,
    };
  }

  async updateSafetySettings(guildId, payload) {
    const guild = this.#guild(guildId);
    if (!guild) return null;
    if (!guild.members?.me?.permissions?.has('ManageGuild')) {
      throw new Error('Bot lacks Manage Guild permission.');
    }

    const updatePayload = {};
    if (payload.verificationLevel !== undefined) updatePayload.verificationLevel = parseInt(payload.verificationLevel, 10);
    if (payload.explicitContentFilter !== undefined) updatePayload.explicitContentFilter = parseInt(payload.explicitContentFilter, 10);
    if (payload.defaultMessageNotifications !== undefined) updatePayload.defaultMessageNotifications = parseInt(payload.defaultMessageNotifications, 10);
    if (payload.safetyAlertsChannelId !== undefined) updatePayload.safetyAlertsChannel = payload.safetyAlertsChannelId || null;

    await guild.edit(updatePayload);

    return {
      guildId: guild.id,
      guildName: guild.name,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      mfaLevel: guild.mfaLevel,
      safetyAlertsChannelId: guild.safetyAlertsChannelId || payload.safetyAlertsChannelId,
    };
  }

  async fetchAutoModRules(guildId) {
    const guild = this.#guild(guildId);
    if (!guild?.autoModerationRules) return null;
    const fetched = await guild.autoModerationRules.fetch();
    return Array.from(fetched.values()).map((r) => this.formatRule(r));
  }

  async createAutoModRule(guildId, payload) {
    const guild = this.#guild(guildId);
    if (!guild?.autoModerationRules) return null;
    if (!guild.members?.me?.permissions?.has('ManageGuild')) {
      throw new Error('Bot lacks Manage Guild permission.');
    }
    const created = await guild.autoModerationRules.create(this.#buildCreatePayload(payload));
    return this.formatRule(created);
  }

  async editAutoModRule(guildId, ruleId, updates) {
    const guild = this.#guild(guildId);
    if (!guild?.autoModerationRules) return null;
    if (!guild.members?.me?.permissions?.has('ManageGuild')) {
      throw new Error('Bot lacks Manage Guild permission.');
    }

    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.enabled !== undefined) payload.enabled = Boolean(updates.enabled);
    if (updates.eventType !== undefined) payload.eventType = parseInt(updates.eventType, 10);
    if (updates.triggerMetadata !== undefined) payload.triggerMetadata = updates.triggerMetadata;
    if (updates.actions !== undefined) {
      payload.actions = updates.actions.map((a) => ({
        type: parseInt(a.type, 10),
        metadata: {
          channel: a.metadata?.channelId,
          durationSeconds: a.metadata?.durationSeconds ? parseInt(a.metadata.durationSeconds, 10) : undefined,
          customMessage: a.metadata?.customMessage,
        },
      }));
    }
    if (updates.exemptRoles !== undefined) payload.exemptRoles = updates.exemptRoles;
    if (updates.exemptChannels !== undefined) payload.exemptChannels = updates.exemptChannels;
    payload.reason = 'Updated via Mochi Safety Dashboard';

    const edited = await guild.autoModerationRules.edit(ruleId, payload);
    return this.formatRule(edited);
  }

  async deleteAutoModRule(guildId, ruleId) {
    const guild = this.#guild(guildId);
    if (!guild?.autoModerationRules) return null;
    if (!guild.members?.me?.permissions?.has('ManageGuild')) {
      throw new Error('Bot lacks Manage Guild permission.');
    }
    await guild.autoModerationRules.delete(ruleId, 'Deleted via Mochi Safety Dashboard');
    return { ruleId };
  }
}

module.exports = { DiscordSafetyGateway };
