export interface Logger {
  info: (feature: string, operation: string, message: string, context?: Record<string, any>) => void;
  warn: (feature: string, operation: string, message: string, context?: Record<string, any>) => void;
  error: (feature: string, operation: string, message: string, context?: Record<string, any>) => void;
}

export function createLogger({ prefix = 'Mochi' }: { prefix?: string } = {}): Logger {
  function line(level: string, feature: string, operation: string, message: string, context?: Record<string, any>): void {
    const parts = [`[${prefix}]`, `[${level}]`];
    if (feature) parts.push(`[${feature}]`);
    if (operation) parts.push(`(${operation})`);
    const ctx: string[] = [];
    if (context?.guildId) ctx.push(`guild=${context.guildId}`);
    if (context?.userId) ctx.push(`user=${context.userId}`);
    const ctxStr = ctx.length ? ` ${ctx.join(' ')}` : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`${parts.join(' ')} ${message}${ctxStr}`);
    if (level === 'error' && context?.error) console.error(context.error);
  }
  return {
    info: (feature: string, operation: string, message: string, context?: Record<string, any>) => line('info', feature, operation, message, context),
    warn: (feature: string, operation: string, message: string, context?: Record<string, any>) => line('warn', feature, operation, message, context),
    error: (feature: string, operation: string, message: string, context?: Record<string, any>) => line('error', feature, operation, message, context),
  };
}

