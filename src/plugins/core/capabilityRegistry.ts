import type { CapabilityContribution } from '../api';

export interface RegisteredCapability extends CapabilityContribution {
  pluginId: string;
}

/** Aggregates plugin-declared authorization capabilities without feature IDs in the host. */
export class CapabilityRegistry {
  private readonly byId = new Map<string, RegisteredCapability>();

  constructor(contributions: readonly RegisteredCapability[] = [], private readonly config: unknown = {}) {
    for (const contribution of contributions) this.byId.set(contribution.id, contribution);
  }

  has(id: string): boolean { return this.byId.has(id); }

  async can(id: string, user: unknown, session: unknown): Promise<boolean> {
    const capability = this.byId.get(id);
    if (!capability) return false;
    return Boolean(await capability.resolve({ user, session, config: this.config }));
  }

  async snapshot(user: unknown, session: unknown): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const id of this.byId.keys()) result[id] = await this.can(id, user, session);
    return result;
  }

  list(): Array<{ id: string; pluginId: string }> {
    return [...this.byId.values()].map(({ id, pluginId }) => ({ id, pluginId }));
  }
}

