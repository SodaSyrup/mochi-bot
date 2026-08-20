/**
 * Minimal structured log helper. Keeps stable context (feature, guildId,
 * userId, operation) in a stable position and never logs secrets.
 */
function createLogger({ prefix = 'Mochi' } = {}) {
  function line(level, feature, operation, message, context) {
    const parts = [`[${prefix}]`, `[${level}]`];
    if (feature) parts.push(`[${feature}]`);
    if (operation) parts.push(`(${operation})`);
    const ctx = [];
    if (context?.guildId) ctx.push(`guild=${context.guildId}`);
    if (context?.userId) ctx.push(`user=${context.userId}`);
    const ctxStr = ctx.length ? ` ${ctx.join(' ')}` : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`${parts.join(' ')} ${message}${ctxStr}`);
    if (level === 'error' && context?.error) {
      console.error(context.error);
    }
  }

  return {
    info: (feature, operation, message, context) => line('info', feature, operation, message, context),
    warn: (feature, operation, message, context) => line('warn', feature, operation, message, context),
    error: (feature, operation, message, context) => line('error', feature, operation, message, context),
  };
}

module.exports = { createLogger };
