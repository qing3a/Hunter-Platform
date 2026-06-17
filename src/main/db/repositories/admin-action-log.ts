import type { DB } from '../connection.js';

export interface AdminActionEntry {
  id: number;
  admin_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details_json: string | null;
  created_at: string;
}

export function createAdminActionLogRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO admin_action_log (admin_user_id, action, target_type, target_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listByAdminStmt = db.prepare(
    'SELECT * FROM admin_action_log WHERE admin_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const listByTargetStmt = db.prepare(
    'SELECT * FROM admin_action_log WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const listAllStmt = db.prepare(
    'SELECT * FROM admin_action_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );

  return {
    insert(input: { admin_user_id: string; action: string; target_type?: string; target_id?: string; details_json?: string }): void {
      insertStmt.run(
        input.admin_user_id, input.action,
        input.target_type ?? null, input.target_id ?? null,
        input.details_json ?? null, new Date().toISOString(),
      );
    },
    listByAdmin(adminId: string, opts: { limit?: number; offset?: number } = {}): AdminActionEntry[] {
      return listByAdminStmt.all(adminId, opts.limit ?? 100, opts.offset ?? 0) as unknown as AdminActionEntry[];
    },
    listByTarget(targetType: string, targetId: string, opts: { limit?: number; offset?: number } = {}): AdminActionEntry[] {
      return listByTargetStmt.all(targetType, targetId, opts.limit ?? 100, opts.offset ?? 0) as unknown as AdminActionEntry[];
    },
    listAll(opts: { limit?: number; offset?: number } = {}): AdminActionEntry[] {
      return listAllStmt.all(opts.limit ?? 100, opts.offset ?? 0) as unknown as AdminActionEntry[];
    },
  };
}