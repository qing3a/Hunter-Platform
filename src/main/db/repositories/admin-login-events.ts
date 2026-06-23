import type { DB } from '../connection.js';

export interface AdminLoginEvent {
  id: number;
  admin_user_id: string | null;
  email: string;
  success: 0 | 1;
  failure_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export function createAdminLoginEventsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO admin_login_events (admin_user_id, email, success, failure_reason, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM admin_login_events WHERE id = ?');

  return {
    insert(input: Omit<AdminLoginEvent, 'id' | 'created_at'> & { created_at?: string }): number {
      const created_at = input.created_at ?? new Date().toISOString();
      const result = insertStmt.run(
        input.admin_user_id,
        input.email,
        input.success,
        input.failure_reason,
        input.ip,
        input.user_agent,
        created_at,
      );
      return Number(result.lastInsertRowid);
    },
    list(filter: { admin_user_id?: string; success?: 0 | 1; email?: string; from?: string; until?: string; limit?: number; offset?: number } = {}): { rows: AdminLoginEvent[]; total: number } {
      const where: string[] = [];
      const params: any[] = [];
      if (filter.admin_user_id) { where.push('admin_user_id = ?'); params.push(filter.admin_user_id); }
      if (filter.success !== undefined) { where.push('success = ?'); params.push(filter.success); }
      if (filter.email) { where.push('email LIKE ?'); params.push(`%${filter.email}%`); }
      if (filter.from) { where.push('created_at >= ?'); params.push(filter.from); }
      if (filter.until) { where.push('created_at < ?'); params.push(filter.until); }
      const whereSql = where.length ? ' AND ' + where.join(' AND ') : '';
      const total = (db.prepare(`SELECT COUNT(*) as cnt FROM admin_login_events WHERE 1=1${whereSql}`)
        .get(...params) as { cnt: number }).cnt;
      const listSql = `SELECT * FROM admin_login_events WHERE 1=1${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const rows = db.prepare(listSql).all(...params, filter.limit ?? 50, filter.offset ?? 0) as unknown as AdminLoginEvent[];
      return { rows, total };
    },
    findById(id: number): AdminLoginEvent | undefined {
      return findByIdStmt.get(id) as AdminLoginEvent | undefined;
    },
  };
}