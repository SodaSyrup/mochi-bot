const config = require('./config');
const client = require('./bot/client');
const { loadBot } = require('./bot/handler');
const DashboardServer = require('./dashboard/server');
const guildRepo = require('./database/repositories/guildRepo');
const inviteRepo = require('./database/repositories/inviteRepo');

async function seedDemoDataIfEmpty() {
  const demoGuildId = '999888777666555444';
  guildRepo.getGuild(demoGuildId, '🌸 Mochi Hangout [Demo]', 'https://cdn.discordapp.com/embed/avatars/1.png');

  // Seed sample inviters if empty
  const count = inviteRepo.getInvitersCount(demoGuildId);
  if (count === 0) {
    console.log('[Seed] Populating initial demo invites and analytics for dashboard...');
    
    const sampleInviters = [
      { id: '111111111111111111', regular: 42, leaves: 3, fake: 1 },
      { id: '222222222222222222', regular: 28, leaves: 4, fake: 0 },
      { id: '333333333333333333', regular: 19, leaves: 2, fake: 2 },
      { id: '444444444444444444', regular: 15, leaves: 1, fake: 0 },
      { id: '555555555555555555', regular: 11, leaves: 0, fake: 1 }
    ];

    for (const inv of sampleInviters) {
      inviteRepo.getOrCreateInviter(demoGuildId, inv.id);
      if (inv.regular > 0) {
        for (let i = 0; i < inv.regular; i++) {
          inviteRepo.recordJoin(demoGuildId, `mem_${inv.id}_${i}`, inv.id, `mochi-${inv.id.slice(0, 4)}`, false);
        }
      }
      if (inv.leaves > 0) {
        for (let i = 0; i < inv.leaves; i++) {
          inviteRepo.recordLeave(demoGuildId, `mem_${inv.id}_${i}`);
        }
      }
    }

    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const joins = Math.floor(Math.random() * 12) + 4;
      const leaves = Math.floor(Math.random() * 4) + 1;
      const fakes = Math.floor(Math.random() * 2);
      for (let j = 0; j < joins; j++) inviteRepo.recordDailyStat(demoGuildId, d, 'joins');
      for (let l = 0; l < leaves; l++) inviteRepo.recordDailyStat(demoGuildId, d, 'leaves');
      for (let f = 0; f < fakes; f++) inviteRepo.recordDailyStat(demoGuildId, d, 'fakes');
    }

    console.log('[Seed] Demo data initialized successfully.');
  }
}

async function bootstrap() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('             🍡  MOCHI DISCORD BOT & DASHBOARD  🍡          ');
  console.log('═══════════════════════════════════════════════════════════');

  await seedDemoDataIfEmpty();

  loadBot(client);

  const dashboard = new DashboardServer(client);
  await dashboard.start(config.dashboard.port);

  if (config.bot.token && config.bot.token !== 'your_discord_bot_token_here') {
    try {
      console.log('[Bot] Connecting to Discord Gateway...');
      await client.login(config.bot.token);
    } catch (err) {
      console.error('[Bot] Failed to log in to Discord Gateway:', err.message);
      console.log('[Bot] Running in standalone Web Dashboard & Simulation mode.');
    }
  } else {
    console.log('[Bot] ℹ️  DISCORD_TOKEN is not set in .env.');
    console.log('[Bot] 🚀 Running in Sandbox & Demo Simulation Mode.');
    console.log(`[Bot] 🌐 Explore and test the live dashboard at: ${config.dashboard.url}`);
  }
}

bootstrap().catch(err => {
  console.error('[Fatal] Bootstrap failed:', err);
  process.exit(1);
});
