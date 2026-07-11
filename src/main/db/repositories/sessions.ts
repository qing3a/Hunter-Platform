import type { DB } from '../connection.js';

export type SessionRow = {
  id: string;
  user_id: string;
  active_role: 'pm' | 'hr' | 'candidate';
  created_at: string;
  expires_at: string;
  last_used_at: string;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

/**
 * session repo (R1.C2 / Task 3)
 *
 * Backed by the `session` table created in migration v031. Each session row
 * carries the active role at the time of last use; the `user_role` table is
 * consulted by `sessionService.resolve`/`refresh` to validate role switches.
 *
 * Used by:
 *  - T3 (this task; service lives in src/main/modules/auth/session.ts)
 *  - T4 (auth middleware calls resolve() on every API request)
 *  - T5 (register/login endpoints call create() / revoke())
 */
export const sessionsRepo = {
  insert(db: DB, row: SessionRow) {
    db.prepare(`
      INSERT INTO session (id, user_id, active_role, created_at, expires_at, last_used_at, revoked_at, ip_address, user_agent)
      VALUES (@id, @user_id, @active_role, @created_at, @expires_at, @last_used_at, @revoked_at, @ip_address, @user_agent)
    `).run(row);
  },

  findActive(db: DB, id: string): SessionRow | undefined {
    return db.prepare(`SELECT * FROM session WHERE id = ? AND revoked_at IS NULL`).get(id) as SessionRow | undefined;
  },

  updateLastUsed(db: DB, id: string, lastUsedAt: string, activeRole: string) {
    db.prepare(`UPDATE session SET last_used_at = ?, active_role = ? WHERE id = ?`).run(lastUsedAt, activeRole, id);
  },

  updateExpiry(db: DB, id: string, expiresAt: string, activeRole: string) {
    db.prepare(`UPDATE session SET expires_at = ?, active_role = ?, last_used_at = ? WHERE id = ?`).run(expiresAt, activeRole, new Date().toISOString(), id);
  },

  revoke(db: DB, id: string) {
    db.prepare(`UPDATE session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(new Date().toISOString(), id);
  },
};