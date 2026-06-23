// Per-admin api_key auth (replaces shared ADMIN_PASSWORD_HASH).
// See docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import type { DB } from '../../db/connection.js';
import { createAdminUsersRepo, type AdminUserRow } from '../../db/repositories/admin-users.js';
import { Errors } from '../../errors.js';

const API_KEY_PREFIX_LEN = 18; // matches handlers/auth.ts generateAdminApiKey

export function createAdminAuthMiddleware(db: DB): RequestHandler {
  const repo = createAdminUsersRepo(db);
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Login is public — it IS the way to obtain a bearer token. Skip auth
    // for POST /auth/login so callers without a key can authenticate.
    if (req.method === 'POST' && req.path === '/auth/login') {
      return next();
    }
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.length <= 7) {
      return next(Errors.unauthorized('Admin auth requires "Authorization: Bearer <admin_api_key>"'));
    }
    const apiKey = auth.slice(7);
    const prefix = apiKey.slice(0, API_KEY_PREFIX_LEN);
    const row = repo.findByApiKeyPrefix(prefix);
    if (!row) return next(Errors.unauthorized('Invalid admin api key'));

    bcrypt.compare(apiKey, row.api_key_hash, (err, ok) => {
      if (err) {
        console.error('adminAuth: bcrypt error', err);
        return next(Errors.internal('Admin auth backend error'));
      }
      if (!ok) return next(Errors.unauthorized('Invalid admin api key'));
      if (row.status === 'suspended') return next(Errors.forbidden('Admin account suspended'));
      // Attach admin context for handlers
      (req as any).admin = row;
      next();
    });
  };
}
