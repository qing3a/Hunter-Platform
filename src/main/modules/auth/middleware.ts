import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { verifyApiKey } from './api-key.js';
import { Errors } from '../../errors.js';
import { API_KEY_PREFIX_LENGTH } from '../../../shared/constants.js';

/**
 * SELECT clause used by both auth middleware variants.
 *
 * Single-slot lookup: api_key_prefix matches AND (api_key_expires_at is NULL
 * or not yet expired). Status filter blocks suspended / deleted users.
 *
 * TRIPWIRE (do not remove this comment without re-reading the security review):
 * The schema still has `prev_api_key_hash` / `prev_api_key_prefix` /
 * `prev_api_key_expires_at` columns (introduced by v006/v007 for a 24h
 * grace window) but we deliberately do NOT consult them here. The Bug 1
 * fix (commit 62329b8) made rotation an immediate cutover with no grace.
 * To re-introduce a grace period, you must re-add the prev_* branches
 * in BOTH CANDIDATE_SELECT and tryVerify — restoring the schema alone
 * is not enough. This guarantees that any reversion to grace behavior
 * is a deliberate code change, not an accidental schema-only flip.
 */
const CANDIDATE_SELECT = `
  SELECT * FROM users
  WHERE status = 'active'
    AND api_key_prefix = ?
    AND (api_key_expires_at IS NULL OR api_key_expires_at > datetime('now'))
`;

/**
 * Try to verify `key` against the current slot. Returns the matched User
 * or undefined. (Grace-slot verification was removed in the Bug 1 fix.)
 */
function tryVerify(candidates: User[], key: string, prefix: string): User | undefined {
  return candidates.find(u =>
    u.api_key_prefix === prefix && verifyApiKey(key, u.api_key_hash)
  );
}

export function authMiddleware(db: DB, usersRepo = createUsersRepo(db)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) throw Errors.unauthorized();
      const key = auth.slice(7);
      // prefix 长度必须 ≥ 12 才能用于缩小候选集
      const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);

      // 通过 prefix 缩小候选集 → 再 bcrypt 验证 (current slot only; grace removed by Bug 1 fix)
      const candidates = db.prepare(CANDIDATE_SELECT).all(prefix) as unknown as User[];
      const matched = tryVerify(candidates, key, prefix);
      if (!matched) throw Errors.unauthorized();

      (req as Request & { user?: User }).user = matched;
      next();
    } catch (e) { next(e); }
  };
}

/**
 * Optional auth — like `authMiddleware` but does NOT reject requests
 * without a valid Bearer header. If a valid key IS present, populates
 * `req.user` for caller personalization / metrics labels.
 *
 * Used by /v1/config/* and /v1/market/leaderboard which are documented
 * as public "unlimited" endpoints (skill.md §5.6). Anonymous callers
 * get the same response as authenticated callers — the difference is
 * only that `req.user` may be undefined.
 */
export function optionalAuthMiddleware(db: DB, usersRepo = createUsersRepo(db)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return next();
      const key = auth.slice(7);
      const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);
      const candidates = db.prepare(CANDIDATE_SELECT).all(prefix) as unknown as User[];
      const matched = tryVerify(candidates, key, prefix);
      if (matched) (req as Request & { user?: User }).user = matched;
      next();
    } catch {
      // Invalid key on an optional-auth endpoint: proceed anonymously
      // (don't punish unauthenticated callers for using an expired key).
      next();
    }
  };
}