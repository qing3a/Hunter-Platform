import type { DB } from '../../db/connection.js';
import { slidingWindowCheck } from './sliding-window.js';

export interface RateLimitWindow {
  windowSeconds: number;
  limit: number;
}

export type RateLimitResult =
  | { allowed: true; remaining: Record<number, number> }
  | { allowed: false; reason: 'RATE_LIMITED'; violatedWindow: number };

/**
 * @deprecated Kept for backward compatibility with the legacy `createRateLimit().check()`
 * API. New code should use `createRateLimitMiddleware()` (see ./middleware.ts) and
 * `slidingWindowCheck()` (see ./sliding-window.ts) directly.
 *
 * Returns the simple `{ allowed, remaining, violatedWindow }` shape. Note: this shim
 * evaluates each window independently and returns the first denial. The aggregate
 * middleware is preferred for IETF headers.
 */
export function createRateLimit(db: DB) {
  return {
    check(userId: string, windows: RateLimitWindow[]): RateLimitResult {
      const remaining: Record<number, number> = {};
      for (const w of windows) {
        const r = slidingWindowCheck(db, userId, w.windowSeconds, w.limit);
        remaining[w.windowSeconds] = r.remaining;
        if (!r.allowed) {
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
