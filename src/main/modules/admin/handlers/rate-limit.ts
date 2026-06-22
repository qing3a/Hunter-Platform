// Migrated from src/main/ipc/rate-limit.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';

export function createAdminRateLimitHandler(db: DB) {
  return {
    listBuckets(user_id?: string): Array<{
      user_id: string; bucket_key: string; count: number; window_started_at: string;
    }> {
      let sql = 'SELECT user_id, window_start, request_count FROM rate_limit_buckets WHERE 1=1';
      const params: any[] = [];
      if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
      sql += ' ORDER BY window_start DESC LIMIT 200';
      const rows = db.prepare(sql).all(...params) as Array<{
        user_id: string; window_start: string; request_count: number;
      }>;
      return rows.map((r) => ({
        user_id: r.user_id,
        bucket_key: `${r.user_id}:${r.window_start}`,
        count: r.request_count,
        window_started_at: r.window_start,
      }));
    },
    clearForUser(user_id: string): { user_id: string; deleted: number } {
      const result = db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
      return { user_id, deleted: Number(result.changes ?? 0) };
    },
  };
}