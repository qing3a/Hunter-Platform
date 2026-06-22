// Migrated from src/main/ipc/admin-log.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';

export function createAdminAdminLogHandler(db: DB) {
  return {
    list(filter: { admin_id?: string; target_type?: string; target_id?: string; limit?: number }): Array<{
      id: number; actor: string; action_type: string;
      target_type: string | null; target_id: string | null;
      reason: string | null; created_at: string;
    }> {
      // Project only the AdminLogItemSchema fields and flatten details_json.reason.
      let sql = `
        SELECT id, admin_user_id, action, target_type, target_id, details_json, created_at
        FROM admin_action_log WHERE 1=1`;
      const params: any[] = [];
      if (filter.admin_id) { sql += ' AND admin_user_id = ?'; params.push(filter.admin_id); }
      if (filter.target_type && filter.target_id) {
        sql += ' AND target_type = ? AND target_id = ?';
        params.push(filter.target_type, filter.target_id);
      }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(filter.limit ?? 200);
      const rows = db.prepare(sql).all(...params) as Array<{
        id: number; admin_user_id: string; action: string;
        target_type: string | null; target_id: string | null;
        details_json: string | null; created_at: string;
      }>;
      return rows.map((r) => {
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
          created_at: r.created_at,
        };
      });
    },
  };
}