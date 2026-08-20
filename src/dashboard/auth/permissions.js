const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');

// Centralized Discord permission helpers. Bitfield logic lives here — routes
// must never reproduce numeric permission checks.

const MANAGE_GUILD_BITS = PermissionFlagsBits.ManageGuild;
const ADMINISTRATOR_BITS = PermissionFlagsBits.Administrator;

/**
 * Parse a Discord permission bitfield string into a BigInt.
 * @param {string|number|bigint} value
 * @returns {bigint}
 */
function parsePermissions(value) {
  try {
    return BigInt(value || 0);
  } catch {
    return 0n;
  }
}

/**
 * Whether a Discord guild is manageable by a user:
 *  - guild owner, or
 *  - has Administrator, or
 *  - has Manage Guild.
 * @param {{ owner?: boolean, permissions?: string|number|bigint }} guild
 */
function canManageGuild(guild) {
  if (guild.owner) return true;
  const bits = parsePermissions(guild.permissions);
  return (bits & ADMINISTRATOR_BITS) === ADMINISTRATOR_BITS ||
    (bits & MANAGE_GUILD_BITS) === MANAGE_GUILD_BITS;
}

/**
 * Cryptographically random OAuth `state` value.
 */
function generateOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { parsePermissions, canManageGuild, generateOAuthState, MANAGE_GUILD_BITS, ADMINISTRATOR_BITS };
