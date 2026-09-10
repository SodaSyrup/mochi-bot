import { test, expect, describe } from 'bun:test';
import path from 'node:path';
import { discoverPluginDescriptors } from '../src/plugins/core/pluginLoader';
import { ServiceContainer } from '../src/plugins/core/serviceContainer';
import { ContributionRegistry } from '../src/plugins/core/contributionRegistry';
import { PluginManager } from '../src/plugins/core/pluginManager';
import { JobManager } from '../src/plugins/core/jobManager';

describe('Plugin-first host contracts', () => {
  test('discovers built-ins from manifests rather than a static catalog', () => {
    const descriptors = discoverPluginDescriptors({ workspaceRoot: path.join(process.cwd(), 'does-not-exist') });
    expect(descriptors.map((descriptor) => descriptor.manifest.id)).toEqual([
      'utility', 'invites', 'invite-logs', 'safety', 'honeypot', 'permission-groups', 'global-bans',
    ]);
    expect(descriptors.every((descriptor) => descriptor.root.endsWith(path.join('src', 'plugins', 'builtins', descriptor.manifest.id)))).toBe(true);
  });

  test('loads an external plugin directory without host source changes', () => {
    const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'external-plugin');
    const descriptors = discoverPluginDescriptors({ includeBuiltins: false, workspaceRoot: path.join(process.cwd(), 'does-not-exist'), configuredPaths: [fixtureRoot] });
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].manifest.id).toBe('external-fixture');
    expect(descriptors[0].plugin.sourceRoot).toBe(descriptors[0].root);
  });

  test('registers external service providers through the public contribution boundary', () => {
    const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'external-plugin');
    const plugin = discoverPluginDescriptors({ includeBuiltins: false, workspaceRoot: path.join(process.cwd(), 'does-not-exist'), configuredPaths: [fixtureRoot] })[0].plugin;
    const services: Record<string, unknown> = {};
    const contributions = new ContributionRegistry({ baseServices: services, serviceTarget: services });
    const manager = new PluginManager({ plugins: [plugin], config: { plugins: { apiVersion: 1 } }, baseContext: { services } , contributions });
    manager.registerAll();
    const container = new ServiceContainer({ config: {}, core: {}, logger: {} as never });
    for (const contribution of contributions.getServiceProviders()) container.register(contribution.pluginId, contribution.provider);
    expect(container.get<{ ready: boolean }>('external-fixture.value')).toEqual({ ready: true });
    expect(contributions.getPageContributions().map((page) => page.id)).toEqual(['external-fixture']);
    expect(contributions.getAssetContributions().map((asset) => asset.id)).toEqual(['external-fixture-assets']);
  });

  test('awaits asynchronous plugin registration before exposing contributions', async () => {
    const contributions = new ContributionRegistry();
    const plugin: any = {
      manifest: { id: 'async-fixture', name: 'Async Fixture', version: '1.0.0', apiVersion: 1 },
      async register(context: any) {
        await Promise.resolve();
        context.pages.register({ id: 'async-fixture', path: '/async-fixture', render() {} });
      },
    };
    const manager = new PluginManager({ plugins: [plugin], config: { plugins: { apiVersion: 1 } }, contributions });
    await manager.registerAll();
    expect(contributions.getPageContributions().map((page) => page.id)).toEqual(['async-fixture']);
  });

  test('service container resolves providers and reports dependency cycles', () => {
    const container = new ServiceContainer({ config: {}, core: {}, logger: {} as never });
    container.register('test', { key: 'a', create: ({ services }) => services.get<number>('b') + 1 });
    container.register('test', { key: 'b', create: () => 4 });
    expect(container.get<number>('a')).toBe(5);
    container.seal();
    expect(() => container.register('late', { key: 'late', create: () => true })).toThrow(/sealed/);
  });

  test('service container detects cycles with a readable chain', () => {
    const container = new ServiceContainer({ config: {}, core: {}, logger: {} as never });
    container.register('test', { key: 'a', create: ({ services }) => services.get('b') });
    container.register('test', { key: 'b', create: ({ services }) => services.get('a') });
    expect(() => container.get('a')).toThrow(/a -> b -> a/);
  });

  test('plugin jobs are centrally started, interval-managed, and stopped', async () => {
    const calls: string[] = [];
    const jobs = new JobManager([{
      pluginId: 'fixture', id: 'fixture-job', intervalMs: 10,
      start: () => { calls.push('start'); },
      stop: () => { calls.push('stop'); },
    }]);
    await jobs.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await jobs.stop();
    expect(calls[0]).toBe('start');
    expect(calls).toContain('stop');
  });
});
