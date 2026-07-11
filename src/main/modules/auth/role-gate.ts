// src/main/modules/auth/role-gate.ts
//
// R1.C2 / T10 — RBAC per-endpoint role gating per spec §7.2.
//
// Layered defense: handler modules already call `assertPm(user)` /
// `assertHeadhunter(user)` / etc. to enforce their own access rules.
// roleGate is the FIRST line of defense applied at the router layer —
// it short-circuits the request before the handler ever runs, and
// uses `active_role` (which may differ from `user_type` when a
// session user has switched roles via X-Active-Role).
//
// Usage in a router file:
//
//   import { authMiddleware } from '../modules/auth/middleware.js';
//   import { roleGate } from '../modules/auth/role-gate.js';
//
//   router.get('/pm-only', authMiddleware(db), roleGate('pm'), handler);
//
// Errors raised here propagate through the global error middleware as
// ApiError UNAUTHORIZED / FORBIDDEN responses (envelope shape, no
// stack traces leaked).

import type { Request, Response, NextFunction } from 'express';
import { Errors } from '../../errors.js';
import type { Role } from '../../db/repositories/user-roles.js';

type AuthedRequest = Request & {
  user?: { active_role?: Role | string; user_type?: Role | string };
};

/**
 * Build an Express middleware that allows the request only when the caller's
 * `active_role` (set by authMiddleware) is one of `allowedRoles`. Falls back
 * to `user_type` when `active_role` is absent — i.e. apikey auth path where
 * the auth middleware doesn't track a separate active role.
 *
 * Returns 401 if there's no authenticated user and 403 if the role is wrong.
 */
export function roleGate(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authedReq = req as AuthedRequest;
    const user = authedReq.user;
    if (!user) return next(Errors.unauthorized());
    const role = (user.active_role ?? user.user_type) as string | undefined;
    if (!role || !(allowedRoles as string[]).includes(role)) {
      return next(Errors.forbidden(`Role '${role ?? 'unknown'}' not allowed here (allowed: ${allowedRoles.join(', ')})`));
    }
    next();
  };
}
