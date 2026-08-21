const { PluginDependencyError } = require('./errors');

/**
 * Stable Kahn topological sort. The input order is used as the tie breaker,
 * which keeps unrelated built-ins in catalog order.
 */
function topologicalSort(plugins) {
  const byId = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));
  const index = new Map(plugins.map((plugin, position) => [plugin.manifest.id, position]));
  const indegree = new Map(plugins.map((plugin) => [plugin.manifest.id, 0]));
  const dependents = new Map(plugins.map((plugin) => [plugin.manifest.id, []]));

  for (const plugin of plugins) {
    for (const dependency of plugin.manifest.requires) {
      if (!byId.has(dependency)) {
        throw new PluginDependencyError(
          `Plugin "${plugin.manifest.id}" requires missing plugin "${dependency}".`,
          { pluginId: plugin.manifest.id }
        );
      }
      indegree.set(plugin.manifest.id, indegree.get(plugin.manifest.id) + 1);
      dependents.get(dependency).push(plugin.manifest.id);
    }
  }

  const ready = plugins
    .filter((plugin) => indegree.get(plugin.manifest.id) === 0)
    .map((plugin) => plugin.manifest.id);
  const result = [];

  while (ready.length > 0) {
    ready.sort((a, b) => index.get(a) - index.get(b));
    const id = ready.shift();
    result.push(byId.get(id));
    for (const dependent of dependents.get(id)) {
      const next = indegree.get(dependent) - 1;
      indegree.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
  }

  if (result.length !== plugins.length) {
    const remaining = new Set(plugins.filter((plugin) => indegree.get(plugin.manifest.id) > 0).map((plugin) => plugin.manifest.id));
    const chain = findCycleChain(plugins, remaining);
    throw new PluginDependencyError(`Circular plugin dependency detected: ${chain.join(' -> ')}.`, { pluginId: chain[0] || null });
  }

  return result;
}

function findCycleChain(plugins, remaining) {
  const byId = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));
  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function visit(id) {
    if (!remaining.has(id)) return null;
    if (visiting.has(id)) return path.slice(path.indexOf(id)).concat(id);
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    for (const dependency of byId.get(id).manifest.requires) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const plugin of plugins) {
    const cycle = visit(plugin.manifest.id);
    if (cycle) return cycle;
  }
  return [...remaining];
}

module.exports = { topologicalSort };
