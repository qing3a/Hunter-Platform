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
    list(filter: { user_type?: string; status?: string; keyword?: string; limit?: number; offset?: number }): { rows: Array<{
      id: string; user_type: 'candidate' | 'headhunter' | 'employer'; name: string;
      quota_per_day: number; quota_used: number; quota_reset_at: string;
      reputation: number; status: 'active' | 'suspended' | 'deleted';
      created_at: string;
    }>; total: number } {
      // Project only the UserPublicSchema fields. Stripping PII (contact, agent_endpoint)
      // and secrets (api_key_hash, api_key_prefix, api_key_expires_at, prev_api_key_*) is
      // the security-critical reason for this change.
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.user_type) { where.push('user_type = ?'); params.push(filter.user_type); }
      if (filter.status) { where.push('status = ?'); params.push(filter.status); }
      if (filter.keyword) { where.push('name LIKE ?'); params.push(`%${filter.keyword}%`); }

      const total = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE ${where.join(' AND ')}`)
        .get(...params) as { cnt: number }).cnt;

      const sql = `
        SELECT id, user_type, name, quota_per_day, quota_used, quota_reset_at,
               reputation, status, created_at
        FROM users WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(...params, filter.limit ?? 20, filter.offset ?? 0) as any;
      return { rows, total };
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
    adjustQuota(
      adminUserId: string,
      user_id: string,
      new_quota: number,
      reason: string,
    ): { user_id: string; previous_quota: number; new_quota: number; reason: string } {
      if (!reason || reason.trim().length < 3) {
        throw Errors.invalidParams('reason is required (>= 3 chars)');
      }
      if (reason.length > 500) {
        throw Errors.invalidParams('reason must be <= 500 chars');
      }
      if (new_quota < 0 || new_quota > 100000) {
        throw Errors.invalidParams('quota must be 0-100000');
      }
      const u = users.findById(user_id);
      if (!u) throw Errors.notFound('User not found');
      const previousQuota = u.quota_per_day;
      // Old value == new value: skip DB write + audit to avoid noise
      if (previousQuota === new_quota) {
        return { user_id, previous_quota: previousQuota, new_quota, reason };
      }
      db.prepare('UPDATE users SET quota_per_day = ?, updated_at = ? WHERE id = ?')
        .run(new_quota, new Date().toISOString(), user_id);
      // Write audit log
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'adjust_user_quota',
        target_type: 'user',
        target_id: user_id,
        details_json: JSON.stringify({
          previous_quota: previousQuota,
          new_quota,
          reason,
        }),
      });
      return { user_id, previous_quota: previousQuota, new_quota, reason };
    },
    get(id: string): {
      id: string; user_type: 'candidate' | 'headhunter' | 'employer'; name: string;
      quota_per_day: number; quota_used: number; quota_reset_at: string;
      reputation: number; status: 'active' | 'suspended' | 'deleted';
      created_at: string;
    } | null {
      const row = db.prepare(
        `SELECT id, user_type, name, quota_per_day, quota_used, quota_reset_at,
                reputation, status, created_at
         FROM users WHERE id = ?`
      ).get(id) as any;
      if (!row) return null;
      return {
        id: row.id,
        user_type: row.user_type,
        name: row.name,
        quota_per_day: row.quota_per_day,
        quota_used: row.quota_used,
        quota_reset_at: row.quota_reset_at,
        reputation: row.reputation,
        status: row.status,
        created_at: row.created_at,
      };
    },
  };
}