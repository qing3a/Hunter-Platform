import type { Request, Response, NextFunction } from 'express';
import { findCapabilityByEndpoint } from '../capabilities/index.js';
import type { Capability } from '../capabilities/types.js';

/**
 * Resolve the capability for the current request and attach it to
 * `req._capability`. Routers downstream read this in `respond()` to write
 * the `x-capability-name` response header.
 *
 * Mount this AFTER the traceContextMiddleware so the capability resolution
 * shows up in spans if needed in the future. Mount it BEFORE the route
 * handlers so every response gets the header.
 *
 * If no capability is declared for the endpoint, `req._capability` stays
 * undefined and the header is omitted. This is a soft signal that the
 * endpoint is unaccounted for; `pnpm capabilities:check` (Task 8) flags
 * such cases in CI.
 */
export function capabilityResolverMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const cap = findCapabilityByEndpoint(req.method, req.path);
    if (cap) (req as Request & { _capability?: Capability })._capability = cap;
    next();
  };
}