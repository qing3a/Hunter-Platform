import type { DB } from '../connection.js';

export type Role = 'pm' | 'hr' | 'candidate';
export const ALL_ROLES: Role[] = ['pm', 'hr', 'candidate'];

/**
 * user-roles repo (R1.C2 / Task 2)
 *
 * Backed by the `user_role` table created in migration v031. Each user may
 * hold any subset of {pm, hr, candidate}; inserting the same (user_id, role)
 * twice is a no-op (PRIMARY KEY conflict, ignored via INSERT OR IGNORE).
 *
 * Used by:
 *  - T3 (session repo needs user.available_roles)
 *  - T4 (auth middleware validates X-Active-Role against this set)
 *  - T5 (register endpoint uses grantAll to bootstrap a new user)
 */
export const userRolesRepo = {
  grant(db: DB, userId: string, role: Role, grantedAt: string): void {
    db.prepare(
      `INSERT OR IGNORE INTO user_role (user_id, role, granted_at) VALUES (?, ?, ?)`,
    ).run(userId, role, grantedAt);
  },

  grantAll(db: DB, userId: string, grantedAt: string): void {
    for (const role of ALL_ROLES) {
      this.grant(db, userId, role, grantedAt);
    }
  },

  revoke(db: DB, userId: string, role: Role): void {
    db.prepare(`DELETE FROM user_role WHERE user_id = ? AND role = ?`).run(userId, role);
  },

  list(db: DB, userId: string): Role[] {
    const rows = db.prepare(`SELECT role FROM user_role WHERE user_id = ?`).all(userId) as Array<{ role: Role }>;
    return rows.map(r => r.role);
  },

  isInRole(db: DB, userId: string, role: Role): boolean {
    const row = db.prepare(`SELECT 1 AS x FROM user_role WHERE user_id = ? AND role = ?`).get(userId, role);
    return !!row;
  },
};
