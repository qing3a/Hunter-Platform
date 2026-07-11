import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { userRolesRepo, type Role } from '../../db/repositories/user-roles.js';
import { sessionService } from './session.js';
import { verifyApiKey } from './api-key.js';
import { Errors } from '../../errors.js';
import { API_KEY_PREFIX_LENGTH } from '../../../shared/constants.js';

/**
 * Authenticated user shape (R1.C2 / Task 4)
 *
 * Populated by `authMiddleware` after a successful Bearer-token lookup. The
 * shape extends the legacy `User` interface with session-specific fields
 * (`auth_method`, `session_id`, `active_role`, `roles`) so downstream handlers
 * can branch on auth method and access the current role without re-querying.
 *
 * Backward-compat: `user_type` is kept populated with the REMAPPED value
 * (pm/hr/candidate — never the legacy headhunter/employer strings). Legacy
 * code reading `req.user.user_type` continues to work; new code should
 * prefer `req.user.active_role`.
 */
export interface AuthedUser {
  id: string;
  name: string;
  /**
   * All roles the user holds (intersection of `users.user_type` legacy column
   * and `user_role` table). Always contains the active role.
   */
  roles: Role[];
  /**
   * The role the caller is currently acting as. For session auth this is
   * the session's `active_role` (possibly switched via `X-Active-Role`).
   * For apikey auth this is the user's primary `user_type` (no switching).
   */
  active_role: Role;
  /**
   * Identifies how the caller authenticated. Affects capability checks:
   *   - `apikey` is reserved for service agents (full quota, no role switch)
   *   - `session` is for human users logging in via the portal
   */
  auth_method: 'session' | 'apikey';
  /** Present only for session auth — the session row id. */
  session_id?: string;
  /** Legacy column. Remapped to pm/hr/candidate. Prefer `active_role`. */
  user_type: Role;
  // Carry over the rest of the legacy User fields so existing handlers
  // (rate-limit, capabilities, etc.) that read `quota_per_day`, `status`,
  // etc. don't need to change. Populated from the `users` row.
  contact: string | null;
  agent_endpoint: string | null;
  api_key_hash: string;
  api_key_prefix: string;
  api_key_expires_at: string | null;
  prev_api_key_hash: string | null;
  prev_api_key_prefix: string | null;
  prev_api_key_expires_at: string | null;
  quota_per_day: number;
  quota_used: number;
  quota_reset_at: string;
  reputation: number;
  status: 'active' | 'suspended' | 'deleted';
  created_at: string;
  updated_at: string;
}

/**
 * SELECT clause used by both auth middleware variants for the apikey path.
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

/**
 * Token prefixes used to dispatch between the two auth paths.
 *  - `sess_*` → session token, validated via sessionService.resolve()
 *  - `hp_live_*` → API key, validated via prefix + bcrypt lookup
 */
const SESSION_TOKEN_PREFIX = 'sess_';
const API_KEY_TOKEN_PREFIX = 'hp_live_';

/**
 * Dual-track auth middleware (R1.C2 / Task 4)
 *
 * Reads `Authorization: Bearer <token>` and dispatches:
 *   - `sess_…` → session lookup (sessionService.resolve). Honors the
 *      `X-Active-Role` header (must be in the user's `available_roles`).
 *   - `hp_live_…` → API-key lookup (legacy path, unchanged behavior).
 *      `X-Active-Role` is IGNORED — apikey auth does not support role
 *      switching (the X-Active-Role header is harmless; we don't 400 it
 *      because that would break clients that always set the header).
 *   - anything else → 401 UNAUTHORIZED.
 *
 * Populates `req.user` as an `AuthedUser`. The legacy `user_type` field
 * is set to the remapped value (pm/hr/candidate) so existing handlers
 * that read it continue to work after the v031 role-rename migration.
 */
export function authMiddleware(db: DB, usersRepo = createUsersRepo(db)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) throw Errors.unauthorized();
      const token = auth.slice(7);

      if (token.startsWith(SESSION_TOKEN_PREFIX)) {
        const xActiveRoleHeader = readActiveRoleHeader(req);
        const resolved = sessionService.resolve(db, token, xActiveRoleHeader);
        if (!resolved) throw Errors.unauthorized();

        // Look up the underlying user so we can populate the full AuthedUser
        // shape (name, quota, status, …). The user row carries the legacy
        // `user_type` column which we've already remapped via v031.
        const user = usersRepo.findById(resolved.user_id);
        if (!user || user.status !== 'active') throw Errors.unauthorized();

        const authedUser: AuthedUser = {
          ...user,
          // user_type from the users row is already remapped (pm/hr/candidate).
          // We still set it explicitly for clarity and to satisfy the narrower
          // `Role` type — defensive in case a future migration stores a raw
          // 'headhunter'/'employer' value.
          user_type: remapLegacyUserType(user.user_type),
          roles: resolved.available_roles,
          active_role: resolved.active_role,
          auth_method: 'session',
          session_id: resolved.session_id,
        };
        (req as Request & { user?: AuthedUser }).user = authedUser;
        next();
        return;
      }

      if (token.startsWith(API_KEY_TOKEN_PREFIX)) {
        // Existing apikey path — unchanged behavior. `X-Active-Role` is
        // ignored on this path (apikey doesn't support role switching).
        const prefix = token.slice(0, API_KEY_PREFIX_LENGTH);
        const candidates = db.prepare(CANDIDATE_SELECT).all(prefix) as unknown as User[];
        const matched = tryVerify(candidates, token, prefix);
        if (!matched) throw Errors.unauthorized();

        // Apikey auth: active_role is the user's primary `user_type`.
        // Lookup the available roles from user_role (always populated after
        // v031 backfill), defaulting to a single-element list when the table
        // has no rows for this user (defensive: apikey callers running on
        // pre-v031 DBs would otherwise see an empty roles array).
        const roles = userRolesRepo.list(db, matched.id);
        const activeRole = remapLegacyUserType(matched.user_type);
        const authedUser: AuthedUser = {
          ...matched,
          user_type: activeRole,
          roles: roles.length > 0 ? roles : [activeRole],
          active_role: activeRole,
          auth_method: 'apikey',
        };
        (req as Request & { user?: AuthedUser }).user = authedUser;
        next();
        return;
      }

      // Unknown token format — reject.
      throw Errors.unauthorized();
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
 *
 * Apikey-only — session tokens are not accepted on optional endpoints.
 * If a session token is supplied, it's silently ignored (the request
 * proceeds anonymously). This keeps public-endpoint contracts stable.
 */
export function optionalAuthMiddleware(db: DB, usersRepo = createUsersRepo(db)): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return next();
      const key = auth.slice(7);
      // Session tokens are not valid for optional endpoints (anonymous
      // access path) — fall through as anonymous.
      if (!key.startsWith(API_KEY_TOKEN_PREFIX)) return next();

      const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);
      const candidates = db.prepare(CANDIDATE_SELECT).all(prefix) as unknown as User[];
      const matched = tryVerify(candidates, key, prefix);
      if (matched) {
        const roles = userRolesRepo.list(db, matched.id);
        const activeRole = remapLegacyUserType(matched.user_type);
        const authedUser: AuthedUser = {
          ...matched,
          user_type: activeRole,
          roles: roles.length > 0 ? roles : [activeRole],
          active_role: activeRole,
          auth_method: 'apikey',
        };
        (req as Request & { user?: AuthedUser }).user = authedUser;
      }
      next();
    } catch {
      // Invalid key on an optional-auth endpoint: proceed anonymously
      // (don't punish unauthenticated callers for using an expired key).
      next();
    }
  };
}

/**
 * Read the `X-Active-Role` header (case-insensitive). Returns the trimmed
 * string value or undefined. We don't validate that the value is a known
 * role here — `sessionService.resolve` validates against the user's
 * available roles and returns null on mismatch (which the middleware
 * surfaces as 401).
 */
function readActiveRoleHeader(req: Request): string | undefined {
  const raw = req.headers['x-active-role'];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Defensive role remap. The v031 migration already updates the users table
 * (`headhunter → hr`, `employer → pm`), so in production this is a no-op.
 * We re-validate here so a stale DB / future regression can't surface the
 * legacy strings to `req.user.user_type` and silently break downstream
 * `user.user_type === 'hr'` checks.
 */
function remapLegacyUserType(raw: string): Role {
  if (raw === 'pm' || raw === 'hr' || raw === 'candidate') return raw;
  if (raw === 'headhunter') return 'hr';
  if (raw === 'employer') return 'pm';
  // Unknown value — fall back to 'candidate' as a safe default rather than
  // crashing the request. Handlers with strict role checks will reject.
  return 'candidate';
}