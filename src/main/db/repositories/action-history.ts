import type { DB } from '../connection.js';

export interface ActionHistoryEntry {
  id: number;
  user_id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  request_summary_json: string | null;
  response_summary_json: string | null;
  status: 'success' | 'error';
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
}

export function createActionHistoryRepo(db: DB) {
  const listByUserStmt = db.prepare(
    'SELECT * FROM action_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  );
  const countByUserStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM action_history WHERE user_id = ?'
  );
  const insertStmt = db.prepare(`
    INSERT INTO action_history (
      user_id, action_type, target_type, target_id,
      request_summary_json, response_summary_json,
      status, error_code, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return {
    insert(entry: Omit<ActionHistoryEntry, 'id'>): number {
      const result = insertStmt.run(
        entry.user_id, entry.action_type,
        entry.target_type ?? null, entry.target_id ?? null,
        entry.request_summary_json ?? null, entry.response_summary_json ?? null,
        entry.status, entry.error_code ?? null, entry.duration_ms ?? null,
        entry.created_at,
      );
      return Number(result.lastInsertRowid);
    },
    listByUser(userId: string, opts: { limit?: number; offset?: number } = {}): ActionHistoryEntry[] {
      return listByUserStmt.all(userId, opts.limit ?? 50, opts.offset ?? 0) as unknown as ActionHistoryEntry[];
    },
    countByUser(userId: string): number {
      return (countByUserStmt.get(userId) as { cnt: number }).cnt;
    },
  };
}
