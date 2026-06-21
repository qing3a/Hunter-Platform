// Migrated from src/main/ipc/users.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';
import { createUsersRepo } from '../../../db/repositories/users.js';
import { createAdminActionLogRepo } from '../../../db/repositories/admin-action-log.js';
import { Errors } from '../../../errors.js';
import { userFlow, applyTransition, type SideEffect } from '../../../flows/index.js';

export function createAdminUsersHandler(db: DB) {
  const users = createUsersRepo(db);
  const adminLog = createAdminActionLogRepo(db);

  /**
   * Dispatch a side effect returned from a user flow transition. Currently
   * the only kind is 'admin_action_log' (writes an audit row). The userFlow
   * declaration includes the side effect so the audit trail is centralized.
   */
  function dispatchSideEffect(effect: SideEffect, adminUserId: string): void {
    if (effect.kind === 'admin_action_log') {
      adminLog.insert({
        admin_user_id: adminUserId,
        action: effect.action_type as string,
        target_type: 'user',
        target_id: effect.target_id as string,
        details_json: JSON.stringify({ reason: effect.reason ?? '' }),
      });
    }
  }

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
    suspend(adminUserId: string, user_id: string, reason: string): { user_id: string; status: string; reason: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      // State-machine check: active → suspended
      // H1 fix: catch TransitionError and convert to 409 INVALID_STATE
      // (previously this would 500 if the user was already suspended)
      let result;
      try {
        result = applyTransition(userFlow, u.status, 'suspend', { user_id, reason });
      } catch (e) {
        throw Errors.invalidState(`User is already ${u.status}; cannot suspend`);
      }
      db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .run(result.next, new Date().toISOString(), user_id);
      // C1 fix: dispatch the side effect declared in userFlow
      if (result.sideEffect) dispatchSideEffect(result.sideEffect, adminUserId);
      return { user_id, status: result.next, reason };
    },
    unsuspend(adminUserId: string, user_id: string): { user_id: string; status: string } {
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      // State-machine check: suspended → active
      // H1 fix: catch TransitionError and convert to 409 INVALID_STATE
      // (previously this would 500 if the user was already active)
      let result;
      try {
        result = applyTransition(userFlow, u.status, 'unsuspend', { user_id });
      } catch (e) {
        throw Errors.invalidState(`User is already ${u.status}; cannot unsuspend`);
      }
      db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .run(result.next, new Date().toISOString(), user_id);
      // C1 fix: dispatch the side effect (unsuspend is terminal, no side effect)
      if (result.sideEffect) dispatchSideEffect(result.sideEffect, adminUserId);
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