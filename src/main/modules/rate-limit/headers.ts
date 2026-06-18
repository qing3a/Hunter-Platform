import type { Response } from 'express';
import type { SlidingWindowCheckResult } from './sliding-window.js';

/** Format: `Limit, Limit, Limit` (one per window, in order 1s/60s/3600s). */
export function formatLimitHeader(limits: number[]): string {
  return limits.join(', ');
}

/** Format: `Remaining, Remaining, Remaining`. */
export function formatRemainingHeader(remainings: number[]): string {
  return remainings.join(', ');
}

/** Format: `Reset, Reset, Reset` (seconds until each window resets). */
export function formatResetHeader(resets: number[]): string {
  return resets.join(', ');
}

/** IETF `Retry-After` (seconds) = max of all window resets, conservative. */
export function formatRetryAfter(resets: number[]): string {
  return String(Math.max(...resets));
}

export function applyRateLimitHeaders(
  res: Response,
  results: SlidingWindowCheckResult[],
  limits: number[],
): void {
  const remainings = results.map(r => r.remaining);
  const resets = results.map(r => r.resetAfterSeconds);

  res.setHeader('RateLimit-Limit', formatLimitHeader(limits));
  res.setHeader('RateLimit-Remaining', formatRemainingHeader(remainings));
  res.setHeader('RateLimit-Reset', formatResetHeader(resets));

  if (results.some(r => !r.allowed)) {
    res.setHeader('Retry-After', formatRetryAfter(resets));
  }
}
