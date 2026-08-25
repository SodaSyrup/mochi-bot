const { GlobalBanRemoteError } = require('../infrastructure/cloudflareGlobalBanClient');

/**
 * Builds a review queue from the selected Discord guild's local bans. This
 * service deliberately never mutates the global registry: recommendations are
 * only hints that an owner may copy into the proposal form.
 */
class GlobalBanRecommendationService {
  constructor({ guildService, adminClient, logger = console, cacheTtlMs = 15_000 }) {
    this.guildService = guildService;
    this.adminClient = adminClient;
    this.logger = logger || console;
    this.cacheTtlMs = Math.max(Number(cacheTtlMs) || 0, 0);
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  async list({ guildId, after = null, limit = 25 } = {}) {
    const normalizedGuildId = String(guildId || '').trim();
    const normalizedAfter = after ? String(after).trim() : null;
    const normalizedLimit = Math.min(Math.max(Number(limit) || 25, 1), 25);
    const key = `${normalizedGuildId}:${normalizedAfter || ''}:${normalizedLimit}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const [guildResult, localBans] = await Promise.all([
      this.guildService.getGuild(normalizedGuildId),
      this.guildService.listBans(normalizedGuildId, { after: normalizedAfter, limit: normalizedLimit }),
    ]);

    const registryResults = await mapWithConcurrency(localBans.bans || [], 5, async (ban) => {
      try {
        return { record: (await this.adminClient.getBan(ban.userId)).record || null, available: true };
      } catch (error) {
        if (error instanceof GlobalBanRemoteError && error.status === 404) {
          return { record: null, available: true };
        }
        this.logger.warn?.('Unable to check a local ban against the global registry.', {
          userId: ban.userId,
          error: error?.message || String(error),
        });
        return { record: null, available: false };
      }
    });

    const registryAvailable = registryResults.every((result) => result.available);
    const value = {
      guild: guildResult.guild,
      recommendations: (localBans.bans || []).map((ban, index) => {
        const result = registryResults[index];
        return {
          ...ban,
          eligible: registryAvailable && !result.record,
          registryState: result.record?.state || null,
          registryRecord: result.record,
        };
      }),
      registryAvailable,
      nextCursor: localBans.nextCursor || null,
      hasMore: Boolean(localBans.hasMore),
    };
    if (this.cacheTtlMs > 0) this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const result = new Array(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return result;
}

module.exports = { GlobalBanRecommendationService };
