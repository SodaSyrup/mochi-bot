import fs from 'node:fs';
import path from 'node:path';
import type { MochiPlugin, PluginManifest } from '../api';
import { PluginValidationError } from './errors';

export interface PluginDescriptor {
  manifest: PluginManifest;
  plugin: MochiPlugin;
  root: string;
  manifestPath: string;
  entryPath: string;
}

interface DiscoveryOptions {
  configuredPaths?: readonly string[];
  includeBuiltins?: boolean;
  builtinsRoot?: string;
  workspaceRoot?: string;
}

const MANIFEST_FILE = 'mochi.plugin.json';

function readManifest(manifestPath: string): PluginManifest {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new PluginValidationError(`Could not read plugin manifest "${manifestPath}".`, { cause: error });
  }
  if (!value || typeof value !== 'object') throw new PluginValidationError(`Plugin manifest "${manifestPath}" must contain an object.`);
  return value as PluginManifest;
}

function realPathWithin(root: string, candidate: string, pluginId: string): string {
  const rootPath = fs.realpathSync(root);
  const candidatePath = path.resolve(candidate);
  const resolvedCandidate = fs.existsSync(candidatePath) ? fs.realpathSync(candidatePath) : candidatePath;
  const relative = path.relative(rootPath, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new PluginValidationError(`Plugin "${pluginId}" references a path outside its package root.` , { pluginId });
  return resolvedCandidate;
}

function manifestCandidates(source: string): string[] {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new PluginValidationError(`Plugin source "${source}" does not exist.`);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return path.basename(resolved) === MANIFEST_FILE ? [resolved] : [];
  const direct = path.join(resolved, MANIFEST_FILE);
  if (fs.existsSync(direct)) return [direct];
  return fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(resolved, entry.name, MANIFEST_FILE)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => path.join(resolved, entry.name, MANIFEST_FILE));
}

function sourceRoots(options: DiscoveryOptions): string[] {
  const roots: string[] = [];
  if (options.includeBuiltins !== false) roots.push(options.builtinsRoot || path.resolve(__dirname, '../builtins'));
  roots.push(options.workspaceRoot || path.resolve(process.cwd(), 'plugins'));
  roots.push(...(options.configuredPaths || []));
  return [...new Set(roots.map((root) => path.resolve(root)))].filter((root) => fs.existsSync(root));
}

export function discoverPluginDescriptors(options: DiscoveryOptions = {}): PluginDescriptor[] {
  const manifests = sourceRoots(options).flatMap((root) => manifestCandidates(root));
  const seen = new Set<string>();
  const descriptors: PluginDescriptor[] = [];

  for (const manifestPath of manifests) {
    const manifest = readManifest(manifestPath);
    if (typeof manifest.id !== 'string' || !manifest.id) throw new PluginValidationError(`Plugin manifest "${manifestPath}" requires id.`);
    if (seen.has(manifest.id)) throw new PluginValidationError(`Duplicate plugin ID "${manifest.id}" discovered.`, { pluginId: manifest.id });
    seen.add(manifest.id);
    const root = fs.realpathSync(path.dirname(manifestPath));
    const entry = typeof manifest.entry === 'string' && manifest.entry.trim() ? manifest.entry : './index.js';
    const entryPath = realPathWithin(root, path.resolve(root, entry), manifest.id);
    if (!fs.existsSync(entryPath)) throw new PluginValidationError(`Plugin "${manifest.id}" entrypoint "${entry}" does not exist.`, { pluginId: manifest.id });

    let loaded: unknown;
    try { loaded = require(entryPath); } catch (error) {
      throw new PluginValidationError(`Plugin "${manifest.id}" entrypoint failed to load.`, { pluginId: manifest.id, cause: error });
    }
    const plugin = ((loaded as { default?: MochiPlugin } | null)?.default || loaded) as MochiPlugin;
    if (!plugin || typeof plugin !== 'object' || !plugin.manifest) throw new PluginValidationError(`Plugin "${manifest.id}" entrypoint must export a plugin object.`, { pluginId: manifest.id });
    if (plugin.manifest.id !== manifest.id) throw new PluginValidationError(`Plugin manifest ID "${manifest.id}" does not match entrypoint ID "${plugin.manifest.id}".`, { pluginId: manifest.id });
    const enriched = { ...plugin, sourceRoot: root, manifest: { ...plugin.manifest, ...manifest, requires: manifest.requires || plugin.manifest.requires || [] } } as MochiPlugin;
    descriptors.push({ manifest: enriched.manifest, plugin: enriched, root, manifestPath, entryPath });
  }

  return descriptors.sort((left, right) => {
    const leftOrder = typeof left.manifest.order === 'number' ? left.manifest.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.manifest.order === 'number' ? right.manifest.order : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.manifest.id.localeCompare(right.manifest.id);
  });
}

export function discoverPluginCatalog(options: DiscoveryOptions = {}): MochiPlugin[] {
  return discoverPluginDescriptors(options).map((descriptor) => descriptor.plugin);
}
