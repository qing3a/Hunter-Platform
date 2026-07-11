import crypto from 'node:crypto';
import type { DB } from '../../db/connection.js';
import { sessionsRepo } from '../../db/repositories/sessions.js';
import { userRolesRepo, type Role } from '../../db/repositories/user-roles.js';

/**
 * Session service (R1.C2 / Task 3)
 *
 * 168-hour (1-week) sliding-window sessions, per design spec D4.
 * Sessions are opaque bearer tokens prefixed `sess_`; the DB stores only
 * the id, user_id, and the currently-active role. Role *availability*
 * comes from `user_role` and is recomputed on every resolve/refresh.
 *
 * Used by:
 *  - T4 (auth middleware calls resolve() per request; X-Active-Role header)
 *  - T5 (register/login endpoints call create() / refresh() / revoke())
 */

export const SESSION_TTL_HOURS = 24 * 7;  // 168h = 1 week, per spec D4
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

function generateSessionId(): string {
  let body = '';
  while (body.length < 32) {
    body += crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
  }
  return 'sess_' + body.slice(0, 32);
}

export type ResolvedSession = {
  session_id: string;
  user_id: string;
  active_role: Role;
  available_roles: Role[];
};

export const sessionService = {
  /**
   * Create a new session for a user, starting in `activeRole`. Returns the
   * session id, user id, active role, and absolute expiry timestamp.
   */
  create(db: DB, userId: string, activeRole: Role, ip: string | null, userAgent: string | null) {
    const id = generateSessionId();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    sessionsRepo.insert(db, {
      id, user_id: userId, active_role: activeRole,
      created_at: now, expires_at: expiresAt, last_used_at: now,
      revoked_at: null, ip_address: ip, user_agent: userAgent,
    });
    return { id, user_id: userId, active_role: activeRole, expires_at: expiresAt };
  },

  /**
   * Resolve a session id to a usable session object, optionally switching the
   * active role. Returns null if the session is missing, expired, revoked,
   * or the requested role is not in the user's available roles.
   *
   * Side-effect: bumps `last_used_at` (and `active_role` if switching).
   */
  resolve(db: DB, sessionId: string, requestedRole?: string): ResolvedSession | null {
    const row = sessionsRepo.findActive(db, sessionId);
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    const availableRoles = userRolesRepo.list(db, row.user_id) as Role[];
    const targetRole = (requestedRole ?? row.active_role) as Role;
    if (!availableRoles.includes(targetRole)) return null;

    sessionsRepo.updateLastUsed(db, sessionId, new Date().toISOString(), targetRole);

    return {
      session_id: row.id,
      user_id: row.user_id,
      active_role: targetRole,
      available_roles: availableRoles,
    };
  },

  /**
   * Extend the session's expiry by 168h (sliding window). Optionally switch
   * the active role at the same time. Returns null on the same conditions
   * as resolve().
   */
  refresh(db: DB, sessionId: string, newActiveRole?: string): { session_id: string; active_role: Role; expires_at: string } | null {
    const row = sessionsRepo.findActive(db, sessionId);
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;

    const availableRoles = userRolesRepo.list(db, row.user_id) as Role[];
    const targetRole = (newActiveRole ?? row.active_role) as Role;
    if (!availableRoles.includes(targetRole)) return null;

    const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    sessionsRepo.updateExpiry(db, sessionId, newExpiry, targetRole);
    return { session_id: sessionId, active_role: targetRole, expires_at: newExpiry };
  },

  /**
   * Revoke a session. Idempotent — calling revoke() on an already-revoked
   * session is a no-op (the repo's UPDATE has `AND revoked_at IS NULL`).
   */
  revoke(db: DB, sessionId: string): void {
    sessionsRepo.revoke(db, sessionId);
  },
};