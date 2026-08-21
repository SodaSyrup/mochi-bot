const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.User,
    Partials.GuildMember
  ]
});

client.commands = new Collection();

module.exports = client;
