import { describe, it, expect } from 'vitest';
import {
  formatLimitHeader,
  formatRemainingHeader,
  formatResetHeader,
  formatRetryAfter,
  applyRateLimitHeaders,
} from '../../../src/main/modules/rate-limit/headers';
import type { SlidingWindowCheckResult } from '../../../src/main/modules/rate-limit/sliding-window';

describe('headers — IETF RateLimit-* formatting', () => {
  it('formatLimitHeader joins three limits with comma+space', () => {
    expect(formatLimitHeader([10, 50, 300])).toBe('10, 50, 300');
  });

  it('formatRemainingHeader joins three remainings with comma+space', () => {
    expect(formatRemainingHeader([8, 47, 285])).toBe('8, 47, 285');
  });

  it('formatResetHeader joins three reset seconds with comma+space', () => {
    expect(formatResetHeader([1, 34, 2105])).toBe('1, 34, 2105');
  });

  it('formatRetryAfter returns the max of the three reset values', () => {
    expect(formatRetryAfter([1, 34, 2105])).toBe('2105');
    expect(formatRetryAfter([10, 5, 100])).toBe('100');
  });

  it('applyRateLimitHeaders sets all 3 headers on res', () => {
    const headers: Record<string, string> = {};
    const fakeRes = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    const results: SlidingWindowCheckResult[] = [
      { allowed: true, remaining: 8,  resetAfterSeconds: 1,   estimated: 2, previousCount: 0, currentCount: 1 },
      { allowed: true, remaining: 47, resetAfterSeconds: 34,  estimated: 3, previousCount: 0, currentCount: 1 },
      { allowed: true, remaining: 285,resetAfterSeconds: 2105,estimated: 15, previousCount: 0, currentCount: 15 },
    ];
    applyRateLimitHeaders(fakeRes, results, [10, 50, 300]);
    expect(headers['RateLimit-Limit']).toBe('10, 50, 300');
    expect(headers['RateLimit-Remaining']).toBe('8, 47, 285');
    expect(headers['RateLimit-Reset']).toBe('1, 34, 2105');
  });

  it('applyRateLimitHeaders sets Retry-After when any window denied', () => {
    const headers: Record<string, string> = {};
    const fakeRes = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    const results: SlidingWindowCheckResult[] = [
      { allowed: true,  remaining: 8,  resetAfterSeconds: 1,   estimated: 2, previousCount: 0, currentCount: 1 },
      { allowed: true,  remaining: 47, resetAfterSeconds: 34,  estimated: 3, previousCount: 0, currentCount: 1 },
      { allowed: false, remaining: 0,  resetAfterSeconds: 2105,estimated: 300,previousCount: 0, currentCount: 300,
        violatedWindowSeconds: 3600, retryAfterSeconds: 2105 },
    ];
    applyRateLimitHeaders(fakeRes, results, [10, 50, 300]);
    expect(headers['Retry-After']).toBe('2105');
  });

  it('applyRateLimitHeaders does NOT set Retry-After when all allowed', () => {
    const headers: Record<string, string> = {};
    const fakeRes = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    const results: SlidingWindowCheckResult[] = [
      { allowed: true, remaining: 8,  resetAfterSeconds: 1, estimated: 2, previousCount: 0, currentCount: 1 },
      { allowed: true, remaining: 47, resetAfterSeconds: 34, estimated: 3, previousCount: 0, currentCount: 1 },
      { allowed: true, remaining: 285,resetAfterSeconds: 2105,estimated: 15, previousCount: 0, currentCount: 15 },
    ];
    applyRateLimitHeaders(fakeRes, results, [10, 50, 300]);
    expect(headers['Retry-After']).toBeUndefined();
  });
});
