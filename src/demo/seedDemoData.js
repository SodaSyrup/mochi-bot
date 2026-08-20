const { AttributionType } = require('../features/invites/domain/attribution');
const { DEMO_GUILD_ID, DEMO_GUILD, DEMO_INVITES, DEMO_LABELS } = require('./fixtures');

// Deterministic demo seed — no randomness. Produces a stable, screenshot-ready
// dataset for APP_MODE=demo. Only called during demo composition.
const DEMO_SEED_INVITERS = [
  { id: '111111111111111111', regular: 42, fake: 1, leaves: 3, bonus: 5 },
  { id: '222222222222222222', regular: 28, fake: 0, leaves: 4, bonus: 0 },
  { id: '333333333333333333', regular: 19, fake: 2, leaves: 2, bonus: 0 },
  { id: '444444444444444444', regular: 15, fake: 0, leaves: 1, bonus: 0 },
  { id: '555555555555555555', regular: 11, fake: 1, leaves: 0, bonus: 0 },
];

function seedDemoData({ inviteRepository, guildRepository, logger }) {
  const guildId = DEMO_GUILD_ID;
  guildRepository.getGuild(guildId, DEMO_GUILD.name, DEMO_GUILD.icon);

  if (inviteRepository.getInvitersCount(guildId) > 0) {
    return false; // already seeded
  }

  for (const [code, l] of Object.entries(DEMO_LABELS)) {
    inviteRepository.setInviteLabel(guildId, code, l.label, l.channelId, l.channelName);
  }
  inviteRepository.saveCachedInvites(guildId, DEMO_INVITES);

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let seq = 0;

  for (const inv of DEMO_SEED_INVITERS) {
    const attribution = { type: AttributionType.INVITE, inviterId: inv.id, inviteCode: 'mochi-welcome' };
    for (let i = 0; i < inv.regular; i++) {
      seq += 1;
      const isFake = i < inv.fake;
      const memberId = `mem_${inv.id}_${i}`;
      const joinedAt = new Date(now - (seq % 7) * DAY).toISOString();
      inviteRepository.trackJoin({ guildId, userId: memberId, attribution, isFake, joinedAt });
    }
    // Departures target non-fake members so inviter `leaves` counts correctly.
    for (let i = 0; i < inv.leaves; i++) {
      const memberId = `mem_${inv.id}_${inv.fake + i}`;
      const leftAt = new Date(now - (i + 1) * DAY).toISOString();
      inviteRepository.trackLeave({ guildId, userId: memberId, leftAt });
    }
    if (inv.bonus) {
      inviteRepository.addBonus({ guildId, userId: inv.id, amount: inv.bonus, reason: 'Demo bonus' });
    }
  }

  // History variety: vanity / unknown / pre-existing members.
  inviteRepository.trackJoin({
    guildId,
    userId: 'mem_vanity_1',
    attribution: { type: AttributionType.VANITY, inviterId: null, inviteCode: null },
    isFake: false,
    joinedAt: new Date(now - 2 * DAY).toISOString(),
  });
  inviteRepository.trackJoin({
    guildId,
    userId: 'mem_unknown_1',
    attribution: { type: AttributionType.UNKNOWN, inviterId: null, inviteCode: null },
    isFake: false,
    joinedAt: new Date(now - 3 * DAY).toISOString(),
  });
  inviteRepository.syncPreExistingMembers(guildId, [
    { userId: 'mem_pre_1', joinedAt: new Date(now - 20 * DAY).toISOString(), isFake: false },
    { userId: 'mem_pre_2', joinedAt: new Date(now - 15 * DAY).toISOString(), isFake: true },
  ]);

  logger?.info('demo', 'seed', 'Demo data seeded into demo database');
  return true;
}

module.exports = { seedDemoData, DEMO_SEED_INVITERS };
