// Migrated from src/main/ipc/users.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createUsersRepo } from '../../../db/repositories/users.js';
import { Errors } from '../../../errors.js';
import { userFlow, applyTransition } from '../../../flows/index.js';

export function createAdminUsersHandler(db: DB) {
  const users = createUsersRepo(db);

  return {
    list(filter: { user_type?: string; status?: string; limit?: number }): unknown[] {
      let sql = 'SELECT * FROM users WHERE 1=1';
      const params: any[] = [];
      if (filter.user_type) { sql += ' AND user_type = ?'; params.push(filter.user_type); }
      if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(filter.limit ?? 100);
      return db.prepare(sql).all(...params);
    },
    suspend(user_id: string, reason: string): { user_id: string; status: string; reason: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      // State-machine check: active → suspended
      const result = applyTransition(userFlow, u.status, 'suspend', { user_id, reason });
      db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .run(result.next, new Date().toISOString(), user_id);
      return { user_id, status: result.next, reason };
    },
    unsuspend(user_id: string): { user_id: string; status: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      // State-machine check: suspended → active
      const result = applyTransition(userFlow, u.status, 'unsuspend', { user_id });
      db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .run(result.next, new Date().toISOString(), user_id);
      return { user_id, status: result.next };
    },
    adjustQuota(user_id: string, new_quota: number): { user_id: string; new_quota: number } {
      if (new_quota < 0 || new_quota > 100000) throw Errors.invalidParams('quota must be 0-100000');
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
        .run(new_quota, new Date().toISOString(), user_id);
      return { user_id, new_quota };
    },
  };
}