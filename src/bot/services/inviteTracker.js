const inviteRepo = require('../../database/repositories/inviteRepo');
const guildRepo = require('../../database/repositories/guildRepo');
const config = require('../../config');

class InviteTrackerService {
  constructor() {
    // In-memory cache of invites: Map<guildId, Map<code, { uses, inviterId, maxUses, createdAt }>>
    this.invitesCache = new Map();
    // Cache for vanity URLs: Map<guildId, uses>
    this.vanityCache = new Map();
  }

  /**
   * Initialize and cache all invites for a guild
   */
  async initGuild(guild) {
    if (!guild || !guild.members) return;

    const guildInvites = new Map();

    try {
      if (guild.members.me?.permissions.has('ManageGuild')) {
        const fetched = await guild.invites.fetch();
        fetched.forEach(inv => {
          guildInvites.set(inv.code, {
            code: inv.code,
            uses: inv.uses || 0,
            inviterId: inv.inviter?.id || null,
            maxUses: inv.maxUses || 0,
            createdAt: inv.createdAt ? inv.createdAt.getTime() : Date.now()
          });
        });
      }

      // Check vanity URL
      if (guild.features && guild.features.includes('VANITY_URL') && guild.fetchVanityData) {
        try {
          const vanityData = await guild.fetchVanityData();
          if (vanityData) {
            this.vanityCache.set(guild.id, vanityData.uses || 0);
          }
        } catch (err) {
          // Vanity might not be configured or missing permission
        }
      }

      this.invitesCache.set(guild.id, guildInvites);

      // Persist to database cache
      const invitesArray = Array.from(guildInvites.values());
      inviteRepo.saveCachedInvites(guild.id, invitesArray);

      console.log(`[InviteTracker] Cached ${guildInvites.size} invites for guild: ${guild.name} (${guild.id})`);

      // Backfill and sync historical / pre-existing members
      await this.syncGuildMembers(guild);
    } catch (err) {
      console.error(`[InviteTracker] Error fetching invites for guild ${guild.id}:`, err.message);
    }
  }

  /**
   * Backfill pre-existing members who joined before the bot was added
   */
  async syncGuildMembers(guild) {
    if (!guild || !guild.members) return 0;
    try {
      const settings = guildRepo.getGuild(guild.id, guild.name, guild.iconURL());
      const thresholdDays = settings.fake_threshold_days || config.inviteTracker.fakeAccountThresholdDays;
      const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

      let membersCollection;
      try {
        membersCollection = await guild.members.fetch();
      } catch {
        membersCollection = guild.members.cache;
      }

      const list = [];
      membersCollection.forEach(member => {
        if (member.user?.bot) return; // Skip bot accounts
        const joinedTime = member.joinedTimestamp || Date.now();
        const createdTime = member.user?.createdTimestamp || joinedTime;
        const isFake = (joinedTime - createdTime) < thresholdMs;

        list.push({
          userId: member.id,
          joinedAt: member.joinedAt ? member.joinedAt.toISOString() : new Date(joinedTime).toISOString(),
          isFake
        });
      });

      const count = inviteRepo.syncPreExistingMembers(guild.id, list);
      if (count > 0) {
        console.log(`[InviteTracker] Backfilled ${count} pre-existing members for guild ${guild.name} (${guild.id})`);
      }
      return count;
    } catch (err) {
      console.error(`[InviteTracker] Error syncing pre-existing members for ${guild.id}:`, err.message);
      return 0;
    }
  }

  /**
   * Process a member join and resolve which invite was used
   */
  async trackJoin(member) {
    const { guild } = member;
    const cachedInvites = this.invitesCache.get(guild.id) || new Map();
    const settings = guildRepo.getGuild(guild.id, guild.name, guild.iconURL());

    let usedInvite = null;
    let inviterUser = null;
    let joinType = 'UNKNOWN'; // NORMAL, VANITY, OAUTH, UNKNOWN

    try {
      if (guild.members.me?.permissions.has('ManageGuild')) {
        const currentInvites = await guild.invites.fetch();

        // Find which invite code increased in uses
        for (const [code, currentInv] of currentInvites) {
          const cached = cachedInvites.get(code);
          if (cached && currentInv.uses > cached.uses) {
            usedInvite = currentInv;
            inviterUser = currentInv.inviter;
            joinType = 'NORMAL';
            break;
          } else if (!cached && currentInv.uses > 0) {
            // New invite created and used while bot was processing
            usedInvite = currentInv;
            inviterUser = currentInv.inviter;
            joinType = 'NORMAL';
            break;
          }
        }

        // If not found in standard invites, check Vanity URL delta
        if (!usedInvite && guild.features.includes('VANITY_URL') && guild.fetchVanityData) {
          try {
            const vanityData = await guild.fetchVanityData();
            const cachedVanityUses = this.vanityCache.get(guild.id) || 0;
            if (vanityData && vanityData.uses > cachedVanityUses) {
              joinType = 'VANITY';
              usedInvite = { code: vanityData.code, uses: vanityData.uses };
              this.vanityCache.set(guild.id, vanityData.uses);
            }
          } catch (e) {
            // Ignore vanity fetch error
          }
        }

        // Refresh in-memory cache
        const newCache = new Map();
        currentInvites.forEach(inv => {
          newCache.set(inv.code, {
            code: inv.code,
            uses: inv.uses || 0,
            inviterId: inv.inviter?.id || null,
            maxUses: inv.maxUses || 0,
            createdAt: inv.createdAt ? inv.createdAt.getTime() : Date.now()
          });
        });
        this.invitesCache.set(guild.id, newCache);
        inviteRepo.saveCachedInvites(guild.id, Array.from(newCache.values()));
      }
    } catch (err) {
      console.error(`[InviteTracker] Error matching invite on join in ${guild.id}:`, err.message);
    }

    // Fake account detection: check account age
    const thresholdDays = settings.fake_threshold_days || config.inviteTracker.fakeAccountThresholdDays;
    const accountAgeDays = (Date.now() - member.user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const isFake = accountAgeDays < thresholdDays;

    let inviterId = null;
    if (joinType === 'NORMAL' && inviterUser) {
      inviterId = inviterUser.id;
    } else if (joinType === 'VANITY') {
      inviterId = 'VANITY';
    } else {
      inviterId = 'UNKNOWN';
    }

    // Record join in database
    const inviterStats = inviteRepo.recordJoin(
      guild.id,
      member.id,
      inviterId,
      usedInvite ? usedInvite.code : (joinType === 'VANITY' ? 'VANITY' : null),
      isFake
    );

    return {
      member,
      usedInvite,
      inviterUser,
      inviterId,
      joinType,
      isFake,
      accountAgeDays: Math.floor(accountAgeDays),
      inviterStats: inviterStats || { total: 0, regular: 0, bonus: 0, leaves: 0, fake: 0 }
    };
  }

  /**
   * Process a member leave and compute penalty
   */
  async trackLeave(member) {
    const { guild } = member;
    const memberRecord = inviteRepo.getInviteMember(guild.id, member.id);
    const affectedInviter = inviteRepo.recordLeave(guild.id, member.id);

    return {
      member,
      memberRecord,
      affectedInviter
    };
  }

  /**
   * Handle when a new invite is created
   */
  handleInviteCreate(invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;

    const cache = this.invitesCache.get(guildId) || new Map();
    cache.set(invite.code, {
      code: invite.code,
      uses: invite.uses || 0,
      inviterId: invite.inviter?.id || null,
      maxUses: invite.maxUses || 0,
      createdAt: invite.createdAt ? invite.createdAt.getTime() : Date.now()
    });
    this.invitesCache.set(guildId, cache);
  }

  /**
   * Handle when an invite is deleted
   */
  handleInviteDelete(invite) {
    const guildId = invite.guild?.id;
    if (!guildId) return;

    const cache = this.invitesCache.get(guildId);
    if (cache) {
      cache.delete(invite.code);
    }
  }

  /**
   * Formats message templates with rich invite placeholders
   */
  formatTemplate(template, data) {
    if (!template) return '';

    const {
      member,
      guild,
      inviterUser,
      inviterStats,
      usedInvite,
      joinType
    } = data;

    const inviterName = inviterUser
      ? (inviterUser.username || inviterUser.tag || 'Unknown')
      : (joinType === 'VANITY' ? 'Vanity URL' : 'Direct / Unknown');

    const inviterTag = inviterUser
      ? (inviterUser.tag || inviterUser.username || 'Unknown')
      : (joinType === 'VANITY' ? 'Vanity URL' : 'Direct / Unknown');

    const inviterTotal = inviterStats?.total || 0;
    const codeStr = usedInvite?.code || (joinType === 'VANITY' ? 'VANITY' : 'N/A');

    return template
      .replace(/{user}/g, member ? `<@${member.id}>` : 'User')
      .replace(/{user\.id}/g, member?.id || '')
      .replace(/{user\.name}/g, member?.user?.username || 'User')
      .replace(/{user\.tag}/g, member?.user?.tag || member?.user?.username || 'User')
      .replace(/{inviter}/g, inviterUser ? `<@${inviterUser.id}>` : inviterName)
      .replace(/{inviter\.name}/g, inviterName)
      .replace(/{inviter\.tag}/g, inviterTag)
      .replace(/{inviter\.invites}/g, `${inviterTotal}`)
      .replace(/{inviter\.regular}/g, `${inviterStats?.regular || 0}`)
      .replace(/{inviter\.bonus}/g, `${inviterStats?.bonus || 0}`)
      .replace(/{inviter\.leaves}/g, `${inviterStats?.leaves || 0}`)
      .replace(/{inviter\.fake}/g, `${inviterStats?.fake || 0}`)
      .replace(/{invite\.code}/g, codeStr)
      .replace(/{guild\.name}/g, guild?.name || 'Server')
      .replace(/{guild\.count}/g, `${guild?.memberCount || 0}`);
  }
}

module.exports = new InviteTrackerService();
