/**
 * Per-guild serial queue. Attribution for a guild must be processed one join
 * at a time (deltas are computed against the previous snapshot), while joins
 * in different guilds may run concurrently.
 *
 * Failed work does not poison the queue: each entry settles independently.
 * Completed entries are cleaned up so the map does not leak per guild.
 *
 * NOTE: this serialization boundary is process-local. If Mochi ever runs
 * multiple processes that can attribute the same guild, a distributed lock or
 * shard-aware design would be required.
 */
class GuildSerialQueue {
  constructor() {
    this.chains = new Map();
  }

  /**
   * @param {string} guildId
   * @param {() => Promise<any>} task
   * @returns {Promise<any>} resolves with the task result, or rejects if the
   *   task itself rejects.
   */
  run(guildId, task) {
    const previous = this.chains.get(guildId) || Promise.resolve();

    const next = previous
      .catch(() => {})
      .then(task);

    this.chains.set(guildId, next);

    // Clean up when this entry completes so an idle guild does not leak.
    next.then(
      () => {
        if (this.chains.get(guildId) === next) this.chains.delete(guildId);
      },
      () => {
        if (this.chains.get(guildId) === next) this.chains.delete(guildId);
      }
    );

    return next;
  }

  get pendingCount() {
    return this.chains.size;
  }
}

module.exports = { GuildSerialQueue };
