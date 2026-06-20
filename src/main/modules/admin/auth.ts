import type { Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { Errors } from '../../errors.js';

/**
 * Admin auth middleware — verifies Bearer token against ADMIN_PASSWORD_HASH.
 *
 * Distinct from regular authMiddleware: admins authenticate with a single
 * shared password (set via ADMIN_PASSWORD_HASH in env), NOT a per-user API key.
 *
 * Usage:
 *   app.use('/v1/admin', createAdminAuthMiddleware(), createAdminRouter(db))
 *
 * Failure modes (all → 401 UNAUTHORIZED):
 *   - Missing Authorization header
 *   - Non-Bearer scheme (e.g. Basic, raw token)
 *   - Empty bearer value
 *   - bcrypt compare returns false
 */
export function createAdminAuthMiddleware(): RequestHandler {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash || hash.length < 20) {
    throw new Error('ADMIN_PASSWORD_HASH must be set (≥20 chars) before mounting admin routes');
  }
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.length <= 7) {
      return next(Errors.unauthorized('Admin auth requires "Authorization: Bearer <ADMIN_PASSWORD>"'));
    }
    const pwd = auth.slice(7);
    // bcrypt is async; we use the callback form to keep this middleware sync-shaped.
    bcrypt.compare(pwd, hash, (err, ok) => {
      if (err) {
        console.error('adminAuth: bcrypt error', err);
        return next(Errors.internal('Admin auth backend error'));
      }
      if (!ok) return next(Errors.unauthorized('Invalid admin password'));
      next();
    });
  };
}