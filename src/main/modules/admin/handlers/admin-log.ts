// Migrated from src/main/ipc/admin-log.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';

export type AdminLogRow = {
  id: number;
  actor: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  details_json: string | null;
  created_at: string;
};

export function createAdminAdminLogHandler(db: DB) {
  return {
    list(filter: {
      admin_id?: string;
      target_type?: string;
      target_id?: string;
      limit?: number;
      offset?: number;
    }): { rows: AdminLogRow[]; total: number } {
      // Project only the AdminLogItemSchema fields. Flatten details_json.reason
      // for backward compat, AND include the raw details_json so admin-web
      // AuditPage can show the full audit envelope (previous_quota/new_quota
      // for adjust-quota, etc.). See docs/superpowers/specs/.../design.md §3.7.
      const where: string[] = ['1=1'];
      const params: any[] = [];
      if (filter.admin_id) { where.push('admin_user_id = ?'); params.push(filter.admin_id); }
      if (filter.target_type && filter.target_id) {
        where.push('target_type = ? AND target_id = ?');
        params.push(filter.target_type, filter.target_id);
      }
      const whereSql = where.join(' AND ');

      // Total count (before pagination)
      const total = (db.prepare(
        `SELECT COUNT(*) AS cnt FROM admin_action_log WHERE ${whereSql}`
      ).get(...params) as { cnt: number }).cnt;

      // Paginated rows
      const rows = db.prepare(`
        SELECT id, admin_user_id, action, target_type, target_id, details_json, created_at
        FROM admin_action_log WHERE ${whereSql}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, filter.limit ?? 20, filter.offset ?? 0) as Array<{
        id: number; admin_user_id: string; action: string;
        target_type: string | null; target_id: string | null;
        details_json: string | null; created_at: string;
      }>;

      const projected: AdminLogRow[] = rows.map((r) => {
        let reason: string | null = null;
        if (r.details_json) {
          try {
            const parsed = JSON.parse(r.details_json);
            if (typeof parsed.reason === 'string') reason = parsed.reason;
          } catch { /* malformed JSON, leave reason as null */ }
        }
        return {
          id: r.id,
          actor: r.admin_user_id,
          action_type: r.action,
          target_type: r.target_type,
          target_id: r.target_id,
          reason,
          details_json: r.details_json,
          created_at: r.created_at,
        };
      });

      return { rows: projected, total };
    },
  };
}