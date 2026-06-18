/**
 * Returns the ISO timestamp of the start of the fixed window that contains `now`.
 * windowSeconds: positive integer (1, 60, 3600, etc.)
 */
export function bucketStart(now: Date, windowSeconds: number): string {
  const ms = now.getTime();
  const bucketMs = Math.floor(ms / (windowSeconds * 1000)) * windowSeconds * 1000;
  return new Date(bucketMs).toISOString();
}

export interface SlidingWindowEstimate {
  estimated: number;
  elapsed: number;
  weight: number;
}

/**
 * Compute the sliding-window estimate of the request count in the last `windowSeconds`
 * preceding `now`, given the counter in the previous fixed window and the counter so far
 * in the current fixed window.
 *
 * Formula: estimated = previous_count × weight + current_count
 *   where weight = (windowSeconds - elapsed) / windowSeconds
 *   and elapsed = seconds since the start of the current window.
 */
export function slidingWindowEstimate(
  now: Date,
  windowSeconds: number,
  previousStart: string,
  currentStart: string,
  previousCount: number,
  currentCount: number,
): SlidingWindowEstimate {
  const nowMs = now.getTime();
  const currentStartMs = new Date(currentStart).getTime();
  const previousStartMs = new Date(previousStart).getTime();

  // Defensive: if same window (clock skew), treat all as current
  if (previousStartMs === currentStartMs) {
    return { estimated: currentCount, elapsed: 0, weight: 0 };
  }

  const elapsed = (nowMs - currentStartMs) / 1000;
  const weight = Math.max(0, (windowSeconds - elapsed) / windowSeconds);
  return {
    estimated: previousCount * weight + currentCount,
    elapsed,
    weight,
  };
}

import type { DB } from '../../db/connection.js';

/** Read the current count for a (user_id, window_start, window_seconds) row. Returns 0 if absent. */
export function readCount(db: DB, userId: string, windowStart: string, windowSeconds: number): number {
  const row = db.prepare(
    'SELECT request_count FROM rate_limit_buckets WHERE user_id = ? AND window_start = ? AND window_seconds = ?'
  ).get(userId, windowStart, windowSeconds) as { request_count: number } | undefined;
  return row?.request_count ?? 0;
}

/**
 * Atomically increment the counter for the current window, creating the row if absent.
 * Mirrors the prepared statement in the legacy bucket.ts implementation.
 */
export function upsertCount(db: DB, userId: string, windowStart: string, windowSeconds: number): void {
  const expires = new Date(new Date(windowStart).getTime() + windowSeconds * 1000 * 2).toISOString();
  db.prepare(`
    INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (user_id, window_start, window_seconds)
    DO UPDATE SET request_count = request_count + 1
  `).run(userId, windowStart, windowSeconds, expires);
}

export interface SlidingWindowCheckResult {
  allowed: boolean;
  remaining: number;
  resetAfterSeconds: number;
  estimated: number;
  previousCount: number;
  currentCount: number;
  /** Only present when allowed=false. */
  violatedWindowSeconds?: number;
  /** Only present when allowed=false. */
  retryAfterSeconds?: number;
}

/**
 * Sliding-window-counter rate limit check. Atomically checks + (on allow) increments
 * the current window's counter. Uses the legacy `rate_limit_buckets` table unchanged.
 *
 * Semantics:
 *   - estimated = previous_count × weight + current_count
 *   - if estimated >= limit → reject (do NOT increment)
 *   - if estimated <  limit → allow and increment current window
 */
export function slidingWindowCheck(
  db: DB,
  userId: string,
  windowSeconds: number,
  limit: number,
  now: Date = new Date(),
): SlidingWindowCheckResult {
  const currentStart = bucketStart(now, windowSeconds);
  const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);

  const previousCount = readCount(db, userId, previousStart, windowSeconds);
  const currentCount = readCount(db, userId, currentStart, windowSeconds);

  const { estimated, elapsed, weight } = slidingWindowEstimate(
    now, windowSeconds, previousStart, currentStart, previousCount, currentCount,
  );
  const resetAfterSeconds = Math.max(1, Math.ceil(windowSeconds - elapsed));

  if (estimated >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAfterSeconds,
      estimated,
      previousCount,
      currentCount,
      violatedWindowSeconds: windowSeconds,
      retryAfterSeconds: resetAfterSeconds,
    };
  }

  // Allowed → increment
  upsertCount(db, userId, currentStart, windowSeconds);
  const newEstimated = previousCount * weight + currentCount + 1;
  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limit - newEstimated)),
    resetAfterSeconds,
    estimated: newEstimated,
    previousCount,
    currentCount: currentCount + 1,
  };
}
