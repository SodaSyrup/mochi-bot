import type { MochiPlugin } from './api';

/** Type-safe helper for declaring an external plugin. */
export function definePlugin<T extends MochiPlugin>(plugin: T): T {
  return plugin;
}

export { stopPropagation } from './api';
export type * from './api';
