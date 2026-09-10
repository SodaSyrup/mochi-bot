import { ForbiddenError, UnauthorizedError } from '../errors';
import type { CapabilityRegistry } from '../../plugins/core/capabilityRegistry';

export function requireCapability(capability: string, registry: CapabilityRegistry | null | undefined) {
  return async (req: any, _res: any, next: (error?: unknown) => void) => {
    if (!req.session?.user) return next(new UnauthorizedError());
    try {
      if (!registry || !(await registry.can(capability, req.session.user, req.session))) return next(new ForbiddenError(`Missing capability: ${capability}.`));
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
