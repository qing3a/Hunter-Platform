import type { DB } from '../../db/connection.js';

export interface RateLimitWindow {
  windowSeconds: number;
  limit: number;
}

export type RateLimitResult =
  | { allowed: true; remaining: Record<number, number> }
  | { allowed: false; reason: 'RATE_LIMITED'; violatedWindow: number };

export function createRateLimit(db: DB) {
  const upsertStmt = db.prepare(`
    INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (user_id, window_start, window_seconds)
    DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `);

  function bucketStart(now: Date, windowSeconds: number): string {
    const ms = now.getTime();
    const bucketMs = Math.floor(ms / (windowSeconds * 1000)) * windowSeconds * 1000;
    return new Date(bucketMs).toISOString();
  }

  return {
    check(userId: string, windows: RateLimitWindow[]): RateLimitResult {
      const now = new Date();
      const remaining: Record<number, number> = {};
      for (const w of windows) {
        const start = bucketStart(now, w.windowSeconds);
        const expires = new Date(new Date(start).getTime() + w.windowSeconds * 1000 * 2).toISOString();
        const row = upsertStmt.get(userId, start, w.windowSeconds, expires) as { request_count: number };
        const remainingCount = Math.max(0, w.limit - row.request_count);
        remaining[w.windowSeconds] = remainingCount;
        if (row.request_count > w.limit) {
          return { allowed: false, reason: 'RATE_LIMITED', violatedWindow: w.windowSeconds };
        }
      }
      return { allowed: true, remaining };
    },

    cleanupExpired(): number {
      const result = db.prepare('DELETE FROM rate_limit_buckets WHERE expires_at < ?')
        .run(new Date().toISOString());
      return Number(result.changes);
    },
  };
}
