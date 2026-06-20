// Migrated from src/main/ipc/rate-limit.ts on 2026-06-20
import type { DB } from '../../../db/connection.js';

export function createAdminRateLimitHandler(db: DB) {
  return {
    listBuckets(user_id?: string): unknown[] {
      const sql = user_id
        ? 'SELECT * FROM rate_limit_buckets WHERE user_id = ? ORDER BY window_start DESC LIMIT 200'
        : 'SELECT * FROM rate_limit_buckets ORDER BY window_start DESC LIMIT 200';
      const params = user_id ? [user_id] : [];
      return db.prepare(sql).all(...params);
    },
    clearForUser(user_id: string): { user_id: string; deleted: number } {
      const result = db.prepare('DELETE FROM rate_limit_buckets WHERE user_id = ?').run(user_id);
      return { user_id, deleted: Number(result.changes ?? 0) };
    },
  };
}