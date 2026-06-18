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
