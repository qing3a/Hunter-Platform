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

  return {
    listByUser(userId: string, opts: { limit?: number; offset?: number } = {}): ActionHistoryEntry[] {
      return listByUserStmt.all(userId, opts.limit ?? 50, opts.offset ?? 0) as unknown as ActionHistoryEntry[];
    },
    countByUser(userId: string): number {
      return (countByUserStmt.get(userId) as { cnt: number }).cnt;
    },
  };
}
