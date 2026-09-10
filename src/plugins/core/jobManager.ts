import type { ManagedJobContribution, PluginLogger } from '../api';

interface JobEntry {
  contribution: ManagedJobContribution & { pluginId: string };
  timer?: ReturnType<typeof setInterval>;
  running?: boolean;
}

/** Starts and stops scheduled plugin jobs. */
export class JobManager {
  private readonly jobs: JobEntry[];
  private readonly logger: PluginLogger | Console;
  private started = false;

  constructor(contributions: Array<ManagedJobContribution & { pluginId: string }> = [], logger: PluginLogger | Console = console) {
    this.jobs = contributions.map((contribution) => ({ contribution }));
    this.logger = logger;
  }

  async start(context: Record<string, unknown> = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      for (const entry of this.jobs) {
        const run = async (failStartup = false) => {
          if (entry.running) return;
          entry.running = true;
          try { await entry.contribution.start({ ...context, pluginId: entry.contribution.pluginId, jobId: entry.contribution.id }); }
          catch (error) {
            if (failStartup) throw error;
            this.logger.error?.('plugins', entry.contribution.pluginId, `Job "${entry.contribution.id}" failed.`, { error });
          } finally { entry.running = false; }
        };
        await run(true);
        if (Number.isFinite(entry.contribution.intervalMs) && (entry.contribution.intervalMs as number) > 0) {
          entry.timer = setInterval(() => void run(), entry.contribution.intervalMs);
        }
      }
    } catch (error) {
      await this.stop(context);
      throw error;
    }
  }

  async stop(context: Record<string, unknown> = {}): Promise<void> {
    if (!this.started && !this.jobs.some((entry) => entry.timer)) return;
    for (const entry of [...this.jobs].reverse()) {
      if (entry.timer) clearInterval(entry.timer);
      entry.timer = undefined;
      if (entry.contribution.stop) await entry.contribution.stop({ ...context, pluginId: entry.contribution.pluginId, jobId: entry.contribution.id });
    }
    this.started = false;
  }

  list(): string[] { return this.jobs.map(({ contribution }) => contribution.id); }
}
