# Rate Limit Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-user fixed-window rate limiting with sliding-window-counter algorithm, inject IETF `RateLimit-*` headers on every authenticated response, and publish limits in skill.md/openapi.json. Eliminate "locked for full window" UX problem.

**Architecture:** New `rate-limit/sliding-window.ts` module (algorithm + DB I/O), `rate-limit/headers.ts` (IETF header formatting), `rate-limit/soft-warning.ts` (20% threshold detection), `rate-limit/middleware.ts` (Express integration mounted after `authMiddleware` in 4 routers). Old `rate-limit/bucket.ts` kept as a feature-flag fallback. Removed `rl.check()` calls from handlers — middleware is the single source of truth. No DB schema change.

**Tech Stack:** TypeScript, vitest, supertest, better-sqlite3 (existing), zod, express.

**Reference spec:** `docs/superpowers/specs/2026-06-19-rate-limit-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/constants.ts` | Modify | Bump 1h thresholds × 1.5; add `RATE_LIMIT_SOFT_WARN_RATIO`, `RATE_LIMIT_ALGO_VERSION` |
| `src/main/modules/rate-limit/sliding-window.ts` | Create | Pure sliding-window-counter math + DB upsert/select |
| `src/main/modules/rate-limit/headers.ts` | Create | IETF `RateLimit-Limit`/`-Remaining`/`-Reset` + `Retry-After` formatting |
| `src/main/modules/rate-limit/soft-warning.ts` | Create | `shouldWarn()` + `buildWarningMessage()` for <20% remaining |
| `src/main/modules/rate-limit/middleware.ts` | Create | Express middleware: call `slidingWindow.check()` for 3 windows, emit headers, return 429 on deny |
| `src/main/modules/rate-limit/bucket.ts` | Unchanged | Old fixed-window impl kept for feature-flag fallback (`RATE_LIMIT_ALGO_VERSION=1`) |
| `src/main/routes/users.ts` | Modify | Mount `rateLimitMiddleware` after `authMiddleware` |
| `src/main/routes/headhunter.ts` | Modify | Mount `rateLimitMiddleware` after `authMiddleware` |
| `src/main/routes/employer.ts` | Modify | Mount `rateLimitMiddleware` after `authMiddleware` |
| `src/main/routes/candidate.ts` | Modify | Mount `rateLimitMiddleware` after `authMiddleware` |
| `src/main/modules/headhunter/handler.ts` | Modify | Remove inline `rl.check()` from `uploadCandidate` (middleware now enforces) |
| `src/main/modules/employer/handler.ts` | Modify | Remove inline `rl.check()` from `createJob` / `expressInterest` / `unlockContact` |
| `tests/unit/rate-limit/sliding-window.test.ts` | Create | Pure algorithm + DB tests |
| `tests/unit/rate-limit/headers.test.ts` | Create | IETF header formatting |
| `tests/unit/rate-limit/soft-warning.test.ts` | Create | Warning trigger logic |
| `tests/unit/rate-limit/middleware.test.ts` | Create | Middleware happy path / 429 / header injection |
| `tests/integration/rate-limit-headers.test.ts` | Create | E2E: protected routes emit headers; 429 path works |
| `tests/integration/rate-limit.test.ts` | Modify | Adapt old `createRateLimit().check()` API test to new `slidingWindow.check()` |
| `docs/superpowers/skill.md` | Modify | Add 限流 section |
| `docs/superpowers/openapi.json` | Modify | Add headers + 429 schema to protected endpoints |
| `docs/CHANGELOG.md` | Modify | Announce algorithm change |
| `tests/load/rate-limit.js` | Modify | Extend k6 scenarios (verify retry-after recovery) |

---

## Task 1: Update rate-limit constants

**Files:**
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Update `RATE_LIMIT_BURSTS` and add two new constants**

In `src/shared/constants.ts`, replace the existing `RATE_LIMIT_BURSTS` block and append two new exports:

```typescript
export const RATE_LIMIT_BURSTS = {
  candidate:  { second: 10, minute: 50,  hour: 300 },
  headhunter: { second: 20, minute: 100, hour: 750 },
  employer:   { second: 30, minute: 200, hour: 1200 },
} as const;

/** Trigger soft warning when remaining / limit falls below this ratio. */
export const RATE_LIMIT_SOFT_WARN_RATIO = 0.20;

/** Algorithm version. 1 = fixed-window (deprecated, kept for rollback), 2 = sliding-window-counter. */
export const RATE_LIMIT_ALGO_VERSION = 2;
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
cd D:\dev\hunter-platform
pnpm typecheck
```

Expected: no errors. (No callers consume the new constants yet, so the change is mechanical.)

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add src/shared/constants.ts
git commit -m "feat(rate-limit): bump 1h thresholds × 1.5 for sliding-window strictness"
```

---

## Task 2: Implement `bucketStart()` helper (pure function)

**Files:**
- Create: `src/main/modules/rate-limit/sliding-window.ts`
- Create: `tests/unit/rate-limit/sliding-window.test.ts`

- [ ] **Step 1: Write failing test for `bucketStart()`**

Create `tests/unit/rate-limit/sliding-window.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { bucketStart } from '../../../src/main/modules/rate-limit/sliding-window';

describe('bucketStart', () => {
  it('floors to the start of the current 1-second window', () => {
    // 2026-06-19T00:00:00.750Z
    const now = new Date('2026-06-19T00:00:00.750Z');
    expect(bucketStart(now, 1)).toBe('2026-06-19T00:00:00.000Z');
  });

  it('floors to the start of the current 1-minute window', () => {
    const now = new Date('2026-06-19T00:00:37.123Z');
    expect(bucketStart(now, 60)).toBe('2026-06-19T00:00:00.000Z');
  });

  it('floors to the start of the current 1-hour window', () => {
    const now = new Date('2026-06-19T05:23:45.678Z');
    expect(bucketStart(now, 3600)).toBe('2026-06-19T05:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: FAIL — module `sliding-window` does not exist.

- [ ] **Step 3: Implement minimal `bucketStart()`**

Create `src/main/modules/rate-limit/sliding-window.ts`:

```typescript
/**
 * Returns the ISO timestamp of the start of the fixed window that contains `now`.
 * windowSeconds: positive integer (1, 60, 3600, etc.)
 */
export function bucketStart(now: Date, windowSeconds: number): string {
  const ms = now.getTime();
  const bucketMs = Math.floor(ms / (windowSeconds * 1000)) * windowSeconds * 1000;
  return new Date(bucketMs).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/sliding-window.ts tests/unit/rate-limit/sliding-window.test.ts
git commit -m "feat(rate-limit): bucketStart helper for sliding-window floors"
```

---

## Task 3: Implement `slidingWindowEstimate()` (pure math, no DB)

**Files:**
- Modify: `src/main/modules/rate-limit/sliding-window.ts`
- Modify: `tests/unit/rate-limit/sliding-window.test.ts`

- [ ] **Step 1: Add failing tests for `slidingWindowEstimate()`**

Append to `tests/unit/rate-limit/sliding-window.test.ts`:

```typescript
import { bucketStart, slidingWindowEstimate } from '../../../src/main/modules/rate-limit/sliding-window';

describe('slidingWindowEstimate', () => {
  it('returns current_count when elapsed = 0 (weight=1)', () => {
    // Just rolled over to a new window — only current counts
    const now = new Date('2026-06-19T00:00:00.000Z');
    const windowSeconds = 60;
    const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
    const currentStart = bucketStart(now, windowSeconds);
    const result = slidingWindowEstimate(now, windowSeconds, previousStart, currentStart, 5, 3);
    // previous_count=5 × weight=1.0 + current_count=3 = 8
    expect(result.estimated).toBe(8);
    expect(result.elapsed).toBe(0);
    expect(result.weight).toBe(1);
  });

  it('returns previous_count when elapsed = window (weight=0)', () => {
    // At the end of the current window — only previous counts
    const now = new Date('2026-06-19T00:00:59.999Z');
    const windowSeconds = 60;
    const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
    const currentStart = bucketStart(now, windowSeconds);
    const result = slidingWindowEstimate(now, windowSeconds, previousStart, currentStart, 5, 3);
    // previous_count=5 × weight≈0 + current_count=3 = 3
    expect(result.estimated).toBeCloseTo(3, 5);
    expect(result.elapsed).toBeCloseTo(60, 2);
    expect(result.weight).toBeCloseTo(0, 2);
  });

  it('blends at half-elapsed', () => {
    const now = new Date('2026-06-19T00:00:30.000Z');
    const windowSeconds = 60;
    const previousStart = bucketStart(new Date(now.getTime() - windowSeconds * 1000), windowSeconds);
    const currentStart = bucketStart(now, windowSeconds);
    const result = slidingWindowEstimate(now, windowSeconds, previousStart, currentStart, 100, 100);
    // weight=0.5, prev=100×0.5 + curr=100 = 150
    expect(result.estimated).toBe(150);
    expect(result.elapsed).toBe(30);
    expect(result.weight).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: FAIL — `slidingWindowEstimate` is not exported.

- [ ] **Step 3: Implement `slidingWindowEstimate()`**

Append to `src/main/modules/rate-limit/sliding-window.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/sliding-window.ts tests/unit/rate-limit/sliding-window.test.ts
git commit -m "feat(rate-limit): slidingWindowEstimate pure function"
```

---

## Task 4: Implement DB layer — `readCount()` and `upsertCount()`

**Files:**
- Modify: `src/main/modules/rate-limit/sliding-window.ts`
- Modify: `tests/unit/rate-limit/sliding-window.test.ts`

- [ ] **Step 1: Add failing tests for `readCount()` and `upsertCount()`**

Append to `tests/unit/rate-limit/sliding-window.test.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { readCount, upsertCount } from '../../../src/main/modules/rate-limit/sliding-window';

describe('readCount / upsertCount', () => {
  const testDbPath = path.join(__dirname, '../../../tmp/sw-unit.db');
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    db = openDb(testDbPath);
    runMigrations(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDbPath); } catch { /* ignore */ } });

  it('readCount returns 0 for a fresh user/window', () => {
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60)).toBe(0);
  });

  it('upsertCount creates a row with count=1', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60)).toBe(1);
  });

  it('upsertCount increments the existing row on conflict', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60)).toBe(3);
  });

  it('upsertCount is scoped by user_id', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_2', '2026-06-19T00:00:00.000Z', 60)).toBe(0);
  });

  it('upsertCount is scoped by windowSeconds', () => {
    upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 3600)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: FAIL — `readCount`/`upsertCount` not exported.

- [ ] **Step 3: Implement `readCount()` and `upsertCount()`**

Append to `src/main/modules/rate-limit/sliding-window.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/sliding-window.ts tests/unit/rate-limit/sliding-window.test.ts
git commit -m "feat(rate-limit): sliding-window DB read/upsert helpers"
```

---

## Task 5: Implement `slidingWindowCheck()` — the public API

**Files:**
- Modify: `src/main/modules/rate-limit/sliding-window.ts`
- Modify: `tests/unit/rate-limit/sliding-window.test.ts`

- [ ] **Step 1: Add failing test for `slidingWindowCheck()`**

Append to `tests/unit/rate-limit/sliding-window.test.ts`:

```typescript
import { slidingWindowCheck } from '../../../src/main/modules/rate-limit/sliding-window';

describe('slidingWindowCheck', () => {
  const testDbPath = path.join(__dirname, '../../../tmp/sw-check.db');
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    db = openDb(testDbPath);
    runMigrations(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDbPath); } catch { /* ignore */ } });

  it('allows a request when estimated < limit and increments the current window', () => {
    const result = slidingWindowCheck(db, 'user_1', 60, 10, new Date('2026-06-19T00:00:30.000Z'));
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);  // limit 10 - (prev 0 × 0.5 + curr 1) = 9
    expect(result.resetAfterSeconds).toBe(30);
  });

  it('rejects when estimated >= limit', () => {
    const now = new Date('2026-06-19T00:00:30.000Z');
    // Pre-fill the previous window to 20
    upsertCount(db, 'user_1', '2026-06-18T23:59:00.000Z', 60);
    for (let i = 0; i < 19; i++) upsertCount(db, 'user_1', '2026-06-18T23:59:00.000Z', 60);
    // Pre-fill the current window to 5
    for (let i = 0; i < 5; i++) upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    // At half-elapsed: prev=20 × 0.5 + curr=5 = 15 ≥ 10 → reject
    const result = slidingWindowCheck(db, 'user_1', 60, 10, now);
    expect(result.allowed).toBe(false);
    expect(result.violatedWindowSeconds).toBe(60);
    expect(result.retryAfterSeconds).toBe(30);
  });

  it('rejected request does NOT increment the counter (no penalty)', () => {
    const now = new Date('2026-06-19T00:00:30.000Z');
    // Fill previous window to 20
    for (let i = 0; i < 20; i++) upsertCount(db, 'user_1', '2026-06-18T23:59:00.000Z', 60);
    // Fill current window to 10 (at limit)
    for (let i = 0; i < 10; i++) upsertCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    const before = readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    slidingWindowCheck(db, 'user_1', 60, 10, now);
    const after = readCount(db, 'user_1', '2026-06-19T00:00:00.000Z', 60);
    expect(after).toBe(before);  // No new row added
  });

  it('returns per-window remaining and resetAfter', () => {
    const now = new Date('2026-06-19T00:00:30.000Z');
    const result = slidingWindowCheck(db, 'user_1', 60, 10, now);
    expect(result.allowed).toBe(true);
    expect(result.previousCount).toBe(0);
    expect(result.currentCount).toBe(1);
    expect(result.estimated).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: FAIL — `slidingWindowCheck` not exported.

- [ ] **Step 3: Implement `slidingWindowCheck()`**

Append to `src/main/modules/rate-limit/sliding-window.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/sliding-window.test.ts
```

Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/sliding-window.ts tests/unit/rate-limit/sliding-window.test.ts
git commit -m "feat(rate-limit): slidingWindowCheck public API"
```

---

## Task 6: Implement headers module — IETF `RateLimit-*` formatting

**Files:**
- Create: `src/main/modules/rate-limit/headers.ts`
- Create: `tests/unit/rate-limit/headers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/rate-limit/headers.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/headers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement header formatters**

Create `src/main/modules/rate-limit/headers.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/headers.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/headers.ts tests/unit/rate-limit/headers.test.ts
git commit -m "feat(rate-limit): IETF RateLimit-* header formatters"
```

---

## Task 7: Implement soft warning module

**Files:**
- Create: `src/main/modules/rate-limit/soft-warning.ts`
- Create: `tests/unit/rate-limit/soft-warning.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/rate-limit/soft-warning.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldWarn, buildWarningMessage } from '../../../src/main/modules/rate-limit/soft-warning';

describe('soft warning', () => {
  it('shouldWarn returns false when remaining / limit >= 0.20', () => {
    expect(shouldWarn(2, 10)).toBe(false);  // 20% exactly — boundary NOT triggered
    expect(shouldWarn(3, 10)).toBe(false);
    expect(shouldWarn(5, 10)).toBe(false);
  });

  it('shouldWarn returns true when remaining / limit < 0.20', () => {
    expect(shouldWarn(1, 10)).toBe(true);
    expect(shouldWarn(0, 10)).toBe(true);
    expect(shouldWarn(19, 100)).toBe(true);
  });

  it('shouldWarn handles limit=0 edge case (returns false, no division by zero)', () => {
    expect(shouldWarn(0, 0)).toBe(false);
    expect(shouldWarn(5, 0)).toBe(false);
  });

  it('buildWarningMessage lists triggered windows with their usage %', () => {
    const msg = buildWarningMessage([
      { windowSeconds: 1,   remaining: 8,  limit: 10 },   // 80% used → not triggered
      { windowSeconds: 60,  remaining: 5,  limit: 50 },   // 90% used → triggered
      { windowSeconds: 3600,remaining: 50, limit: 300 },  // 83% used → not triggered
    ], 0.20);
    expect(msg).toBe('approaching-limit: minute window at 90%');
  });

  it('buildWarningMessage returns empty string when no window triggers', () => {
    const msg = buildWarningMessage([
      { windowSeconds: 1,   remaining: 8, limit: 10 },
      { windowSeconds: 60,  remaining: 45, limit: 50 },
      { windowSeconds: 3600,remaining: 280, limit: 300 },
    ], 0.20);
    expect(msg).toBe('');
  });

  it('buildWarningMessage lists multiple triggered windows', () => {
    const msg = buildWarningMessage([
      { windowSeconds: 1,   remaining: 1,  limit: 10 },   // triggered
      { windowSeconds: 60,  remaining: 5,  limit: 50 },   // triggered
      { windowSeconds: 3600,remaining: 250, limit: 300 }, // 83% not triggered
    ], 0.20);
    expect(msg).toContain('second');
    expect(msg).toContain('minute');
    expect(msg).not.toContain('hour');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/soft-warning.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement soft warning**

Create `src/main/modules/rate-limit/soft-warning.ts`:

```typescript
import { RATE_LIMIT_SOFT_WARN_RATIO } from '../../../shared/constants.js';

const WINDOW_NAME: Record<number, string> = {
  1: 'second',
  60: 'minute',
  3600: 'hour',
};

/** True when remaining / limit < threshold (default 0.20). Boundary: exactly 20% is NOT triggered. */
export function shouldWarn(remaining: number, limit: number, ratio = RATE_LIMIT_SOFT_WARN_RATIO): boolean {
  if (limit <= 0) return false;
  return remaining / limit < ratio;
}

export interface WarningWindowState {
  windowSeconds: number;
  remaining: number;
  limit: number;
}

/**
 * Build a human-readable warning message listing all windows currently above the soft-warn
 * threshold. Format: `approaching-limit: <name> window at <pct>%, <name> window at <pct>%`
 * Returns empty string when no window triggers.
 */
export function buildWarningMessage(
  windows: WarningWindowState[],
  ratio = RATE_LIMIT_SOFT_WARN_RATIO,
): string {
  const triggered = windows
    .filter(w => shouldWarn(w.remaining, w.limit, ratio))
    .map(w => {
      const used = 1 - w.remaining / w.limit;
      const name = WINDOW_NAME[w.windowSeconds] ?? `${w.windowSeconds}s`;
      return `${name} window at ${Math.round(used * 100)}%`;
    });
  return triggered.length === 0 ? '' : `approaching-limit: ${triggered.join(', ')}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/soft-warning.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/soft-warning.ts tests/unit/rate-limit/soft-warning.test.ts
git commit -m "feat(rate-limit): soft warning at <20% remaining"
```

---

## Task 8: Implement rate-limit middleware

**Files:**
- Create: `src/main/modules/rate-limit/middleware.ts`
- Create: `tests/unit/rate-limit/middleware.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/rate-limit/middleware.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../../src/main/db/connection';
import { runMigrations } from '../../../src/main/db/migrations';
import { createRateLimitMiddleware } from '../../../src/main/modules/rate-limit/middleware';
import type { User } from '../../../src/shared/types';

function fakeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: any = null;
  return {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status: (c: number) => { statusCode = c; return { json: (b: any) => { body = b; } }; },
    get statusCode() { return statusCode; },
    get body() { return body; },
    get headers() { return headers; },
  } as any;
}

describe('rate-limit middleware', () => {
  const testDbPath = path.join(__dirname, '../../../tmp/mw.db');
  let db: ReturnType<typeof openDb>;
  const candidate: User = {
    id: 'user_test', user_type: 'candidate', name: 'T', contact: null, agent_endpoint: null,
    api_key_hash: 'x', api_key_prefix: 'x', quota_per_day: 50, quota_used: 0, quota_reset_at: 'x',
    reputation: 50, status: 'active', created_at: 'x', updated_at: 'x',
  };

  beforeEach(() => {
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    db = openDb(testDbPath);
    runMigrations(db);
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDbPath); } catch { /* ignore */ } });

  it('allows request under limit and calls next() with headers set', () => {
    const mw = createRateLimitMiddleware(db);
    const req = { user: candidate } as any;
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.headers['RateLimit-Limit']).toBe('10, 50, 300');
    expect(res.headers['RateLimit-Remaining']).toBeDefined();
    expect(res.headers['RateLimit-Reset']).toBeDefined();
  });

  it('returns 429 with Retry-After and proper body when any window denied', () => {
    // Pre-fill: 11 requests in the last hour (exceeds 1h limit=300? no, 11<300)
    // Need to push past 1h limit of 300 → directly insert into rate_limit_buckets
    const currentStart = (() => {
      const ms = Date.now();
      const hourMs = 3600 * 1000;
      return new Date(Math.floor(ms / hourMs) * hourMs).toISOString();
    })();
    for (let i = 0; i < 301; i++) {
      db.prepare(`
        INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
        VALUES (?, ?, 3600, 1, '2099-01-01T00:00:00.000Z')
        ON CONFLICT (user_id, window_start, window_seconds)
        DO UPDATE SET request_count = request_count + 1
      `).run('user_test', currentStart);
    }

    const mw = createRateLimitMiddleware(db);
    const req = { user: candidate } as any;
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details.violated_window).toBe('hour');
  });

  it('adds soft warning headers when any window remaining < 20%', () => {
    // Fill the 1h window to 250/300 (83% used) so remaining is 50/300 = 16.7% < 20%
    const currentStart = (() => {
      const ms = Date.now();
      const hourMs = 3600 * 1000;
      return new Date(Math.floor(ms / hourMs) * hourMs).toISOString();
    })();
    for (let i = 0; i < 250; i++) {
      db.prepare(`
        INSERT INTO rate_limit_buckets (user_id, window_start, window_seconds, request_count, expires_at)
        VALUES (?, ?, 3600, 1, '2099-01-01T00:00:00.000Z')
        ON CONFLICT (user_id, window_start, window_seconds)
        DO UPDATE SET request_count = request_count + 1
      `).run('user_test', currentStart);
    }

    const mw = createRateLimitMiddleware(db);
    const req = { user: candidate } as any;
    const res = fakeRes();
    mw(req, res, () => {});
    expect(res.headers['RateLimit-Policy']).toBe('warn');
    expect(res.headers['X-RateLimit-Warning']).toContain('hour');
  });

  it('returns 401-style error when req.user is missing', () => {
    const mw = createRateLimitMiddleware(db);
    const req = {} as any;
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('FAILS OPEN when DB throws (passes request through, logs error)', () => {
    // Inject a broken DB whose prepare() throws
    const brokenDb = {
      prepare: () => { throw new Error('db is broken'); },
    } as any;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mw = createRateLimitMiddleware(brokenDb);
    const req = { user: candidate } as any;
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);   // fail-open: do not block
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('rate-limit DB error'), expect.any(Error));
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/middleware.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement middleware**

Create `src/main/modules/rate-limit/middleware.ts`:

```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { RATE_LIMIT_BURSTS, RATE_LIMIT_ALGO_VERSION, RATE_LIMIT_SOFT_WARN_RATIO } from '../../../shared/constants.js';
import { slidingWindowCheck } from './sliding-window.js';
import { applyRateLimitHeaders } from './headers.js';
import { shouldWarn, buildWarningMessage } from './soft-warning.js';
import { Errors } from '../../errors.js';

const WINDOWS: { seconds: 1 | 60 | 3600; key: 'second' | 'minute' | 'hour' }[] = [
  { seconds: 1,    key: 'second' },
  { seconds: 60,   key: 'minute' },
  { seconds: 3600, key: 'hour'   },
];

/**
 * Express middleware that enforces per-user rate limits using the sliding-window-counter
 * algorithm and emits IETF `RateLimit-*` headers on every response.
 *
 * MUST be mounted AFTER `authMiddleware` so `req.user` is populated.
 */
export function createRateLimitMiddleware(db: DB): RequestHandler {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Feature-flag: if algo is set to 1, skip entirely (fallback to old behavior)
    if (RATE_LIMIT_ALGO_VERSION !== 2) {
      next();
      return;
    }

    const user = (req as Request & { user?: User }).user;
    if (!user) {
      // Should never happen if mounted after authMiddleware; fail-safe
      next(Errors.internal('rateLimitMiddleware: req.user missing'));
      return;
    }

    const limits = RATE_LIMIT_BURSTS[user.user_type];

    // FAIL-OPEN: if DB throws, log and pass through. Rate-limiter is auxiliary, not
    // business-critical — better to let 1 spammer through than block all users.
    let results: ReturnType<typeof slidingWindowCheck>[];
    try {
      results = WINDOWS.map(w =>
        slidingWindowCheck(db, user.id, w.seconds, limits[w.key]),
      );
    } catch (err) {
      console.error('rate-limit DB error; failing open:', err);
      next();
      return;
    }

    const limitValues = WINDOWS.map(w => limits[w.key]);
    applyRateLimitHeaders(res, results, limitValues);

    // Soft warning: any window remaining < 20%?
    const warnStates = WINDOWS.map((w, i) => ({
      windowSeconds: w.seconds,
      remaining: results[i].remaining,
      limit: limits[w.key],
    }));
    const triggered = warnStates.some(s => shouldWarn(s.remaining, s.limit, RATE_LIMIT_SOFT_WARN_RATIO));
    if (triggered) {
      const msg = buildWarningMessage(warnStates, RATE_LIMIT_SOFT_WARN_RATIO);
      if (msg) {
        res.setHeader('RateLimit-Policy', 'warn');
        res.setHeader('X-RateLimit-Warning', msg);
      }
    }

    // Denied?
    const denied = results.find(r => !r.allowed);
    if (denied) {
      const windowName = WINDOWS.find(w => w.seconds === denied.violatedWindowSeconds)?.key ?? 'hour';
      throw Errors.rateLimited('Burst rate limit exceeded', {
        violated_window: windowName,
        retry_after_seconds: denied.retryAfterSeconds,
      });
    }

    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/unit/rate-limit/middleware.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/middleware.ts tests/unit/rate-limit/middleware.test.ts
git commit -m "feat(rate-limit): Express middleware with IETF headers + soft warning"
```

---

## Task 9: Mount middleware in 4 routers

**Files:**
- Modify: `src/main/routes/users.ts`
- Modify: `src/main/routes/headhunter.ts`
- Modify: `src/main/routes/employer.ts`
- Modify: `src/main/routes/candidate.ts`

- [ ] **Step 1: Mount in `users.ts`**

In `src/main/routes/users.ts`, after the line `router.use(authMiddleware(db));`, add:

```typescript
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
// ...
router.use(createRateLimitMiddleware(db));
```

The final shape:
```typescript
router.use(authMiddleware(db));
router.use(createRateLimitMiddleware(db));
```

- [ ] **Step 2: Mount in `headhunter.ts`**

In `src/main/routes/headhunter.ts`, after `router.use(authMiddleware(db));`, add:

```typescript
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
// ...
router.use(createRateLimitMiddleware(db));
```

- [ ] **Step 3: Mount in `employer.ts`**

In `src/main/routes/employer.ts`, after `router.use(authMiddleware(db));`, add:

```typescript
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
// ...
router.use(createRateLimitMiddleware(db));
```

- [ ] **Step 4: Mount in `candidate.ts`**

In `src/main/routes/candidate.ts`, after `router.use(authMiddleware(db));`, add:

```typescript
import { createRateLimitMiddleware } from '../modules/rate-limit/middleware.js';
// ...
router.use(createRateLimitMiddleware(db));
```

- [ ] **Step 5: Verify typecheck**

Run:
```bash
cd D:\dev\hunter-platform
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/routes/users.ts src/main/routes/headhunter.ts src/main/routes/employer.ts src/main/routes/candidate.ts
git commit -m "feat(rate-limit): mount middleware in 4 protected routers"
```

---

## Task 10: Remove inline `rl.check()` calls from handlers

The middleware now enforces rate limits. Handlers should NOT call `rl.check()` themselves (would double-count). We keep the imports / module for other potential uses (e.g., register handler) but remove the per-handler call sites.

**Files:**
- Modify: `src/main/modules/headhunter/handler.ts`
- Modify: `src/main/modules/employer/handler.ts`

- [ ] **Step 1: Remove inline rate limit in `headhunter/handler.ts` `uploadCandidate`**

In `src/main/modules/headhunter/handler.ts`, find and delete the entire `// 3. 突发限流` block in `uploadCandidate`:

```typescript
      // 3. 突发限流
      const limits = RATE_LIMIT_BURSTS.headhunter;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');
```

(Just remove these 7 lines. The step comment that follows is `// 4. 配额扣减`.)

Also remove unused imports: `createRateLimit`, `RATE_LIMIT_BURSTS`. Final imports in this file should NOT include these. Keep the `rl` variable definition if it's still used (it isn't anymore — also remove `const rl = createRateLimit(db);`).

Result: in the `createHeadhunterHandler` factory, remove:
```typescript
  const rl = createRateLimit(db);
```

And the imports at the top:
```typescript
import { createRateLimit } from '../rate-limit/bucket.js';
// ...
import { QUOTA_COSTS, RATE_LIMIT_BURSTS } from '../../../shared/constants.js';
```

should become:
```typescript
import { QUOTA_COSTS } from '../../../shared/constants.js';
```

- [ ] **Step 2: Remove inline rate limit in `employer/handler.ts` (3 sites)**

In `src/main/modules/employer/handler.ts`, find and delete the rate-limit block in 3 functions: `createJob`, `expressInterest`, `unlockContact`. Each has the pattern:

```typescript
      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');
```

Delete all 3 occurrences. Then remove:
- `import { createRateLimit } from '../rate-limit/bucket.js';`
- `import { QUOTA_COSTS, RATE_LIMIT_BURSTS } from '../../../shared/constants.js';` → `import { QUOTA_COSTS } from '../../../shared/constants.js';`
- `const rl = createRateLimit(db);` in the factory

- [ ] **Step 3: Verify typecheck**

Run:
```bash
cd D:\dev\hunter-platform
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Run existing handler tests to confirm no regression**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/integration/headhunter-recommend.test.ts tests/integration/employer-handler.test.ts tests/integration/upload-candidate.test.ts
```

Expected: all PASS. (Existing tests use very low request rates — they shouldn't hit rate limits.)

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/headhunter/handler.ts src/main/modules/employer/handler.ts
git commit -m "refactor(rate-limit): remove inline rl.check() — middleware is sole source"
```

---

## Task 11: Integration test — middleware emits headers in real HTTP flow

**Files:**
- Create: `tests/integration/rate-limit-headers.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/rate-limit-headers.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('rate-limit headers (integration)', () => {
  const testDb = path.join(__dirname, '../../tmp/rl-headers.db');
  let app: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch { /* ignore */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch { /* ignore */ } });

  /** Register a fresh headhunter and return { userId, apiKey }. Each test uses a unique user
   *  so rate-limit state doesn't bleed between tests. */
  async function registerHeadhunter(name: string): Promise<{ userId: string; apiKey: string }> {
    const reg = await request(app)
      .post('/v1/auth/register')
      .send({ user_type: 'headhunter', name, contact: `${name}@test.com` });
    expect(reg.status).toBe(200);
    return { userId: reg.body.data.id, apiKey: reg.body.data.api_key };
  }

  it('protected endpoint returns RateLimit-* headers on 200', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL1');
    const res = await request(app)
      .get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20, 100, 750');        // headhunter limits
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['ratelimit-reset']).toBeDefined();
    expect(res.headers['retry-after']).toBeUndefined();                  // 200, not 429
  });

  it('public endpoint (skill.md) does NOT have rate-limit headers', async () => {
    const res = await request(app).get('/v1/skill.md');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  it('RateLimit-Remaining decrements across successive requests', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL2');
    const r1 = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    const r2 = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    const r1Rem = Number(r1.headers['ratelimit-remaining'].split(',')[0]);
    const r2Rem = Number(r2.headers['ratelimit-remaining'].split(',')[0]);
    expect(r2Rem).toBe(r1Rem - 1);   // 1s window: each request consumes 1
  });

  it('returns 429 with Retry-After when 1s limit exceeded', async () => {
    const { userId, apiKey } = await registerHeadhunter('RL3');
    // headhunter 1s limit = 20 → fire 20 requests then expect 21st to be 429
    for (let i = 0; i < 20; i++) {
      await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    }
    const r = await request(app).get(`/v1/users/${userId}/status`).set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.body.error.code).toBe('RATE_LIMITED');
    expect(r.body.error.details.violated_window).toBe('second');
  });
});
```

Why this rewrite: the previous version used `require.cache` invalidation (CommonJS pattern) and a `beforeEach` DB reset. The project is pure ESM (uses `await import()`), and DB re-connection is fragile. Per-test fresh users are simpler and equally isolating.

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/integration/rate-limit-headers.test.ts
```

Expected: PASS (4 tests). Note: `ratelimit-` header lookup is case-insensitive in supertest, so we use lowercase.

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add tests/integration/rate-limit-headers.test.ts
git commit -m "test(rate-limit): integration test for IETF headers and 429"
```

---

## Task 12: Update existing `tests/integration/rate-limit.test.ts`

The existing test exercises the old `createRateLimit().check()` API. We keep the old API alive (it now just delegates to the new one) so the test continues to work as a smoke test for the DB layer.

**Files:**
- Modify: `src/main/modules/rate-limit/bucket.ts` (compat shim)
- Modify: `tests/integration/rate-limit.test.ts` (update assertion)

- [ ] **Step 1: Add backward-compat shim in `bucket.ts`**

The old test imports `createRateLimit` from `bucket.ts`. We keep that export but reimplement it using the new sliding-window functions. In `src/main/modules/rate-limit/bucket.ts`, replace the entire file contents with:

```typescript
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
```

- [ ] **Step 2: Run existing rate-limit test to verify it still passes**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/integration/rate-limit.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/rate-limit/bucket.ts
git commit -m "refactor(rate-limit): keep legacy createRateLimit() as compat shim over slidingWindow"
```

---

## Task 13: Update `docs/superpowers/skill.md` — add 限流 section

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 1: Find the right insertion point**

Run:
```bash
cd D:\dev\hunter-platform
grep -n "^##" docs/superpowers/skill.md
```

Pick a good location — typically after "错误处理" or before "附录". Let's insert it as a new top-level section after "认证" or after "错误处理".

- [ ] **Step 2: Append the 限流 section**

Append the following block at the end of `docs/superpowers/skill.md` (or in the chosen location):

```markdown
## 限流

所有认证请求受三层滑动窗口限流（1s / 60s / 3600s），实现为 sliding-window-counter 算法（不是 fixed-window，因此撞限后能渐进恢复，不会"锁一整窗口"）。

| 用户类型 | 1s 突发 | 1min | 1h |
|---|---|---|---|
| candidate | 10 | 50 | 300 |
| headhunter | 20 | 100 | 750 |
| employer | 30 | 200 | 1200 |

### 响应头（每个认证请求）

每个受保护 endpoint 的响应都带 IETF `RateLimit-*` headers，按 1s/60s/3600s 顺序：

| Header | 示例 | 含义 |
|---|---|---|
| `RateLimit-Limit` | `20, 100, 750` | 三个窗口的上限 |
| `RateLimit-Remaining` | `18, 98, 745` | 三个窗口的剩余配额 |
| `RateLimit-Reset` | `1, 45, 2105` | 三个窗口到下次重置的秒数 |

### 软警告

当任一窗口 `remaining / limit < 20%` 时，响应额外带：

| Header | 含义 |
|---|---|
| `RateLimit-Policy: warn` | 标记进入软警告状态 |
| `X-RateLimit-Warning: approaching-limit: hour window at 85%` | 人类可读的具体窗口与占用率 |

### 429 响应

- 状态码 429
- `Retry-After: <秒数>` —— 等于三个窗口 reset 中的最大值（最保守）
- body:
  ```json
  {
    "ok": false,
    "error": {
      "code": "RATE_LIMITED",
      "message": "Burst rate limit exceeded",
      "details": { "violated_window": "second|minute|hour", "retry_after_seconds": 1 }
    }
  }
  ```

### 客户端建议

- 主动读 `RateLimit-Remaining`
- 任一窗口 remaining < 20% 时主动降速
- 收到 `RateLimit-Policy: warn` 时按 `Retry-After` 调度退避
- 收到 429 时严格按 `Retry-After` 等待后再重试

### 不受限的 endpoint

以下 endpoint 不走 per-user 限流：

- `POST /v1/auth/register`（独立的 IP 限流，5/h）
- `GET /v1/health`
- `GET /v1/skill.md` / `GET /v1/openapi.json`
- `GET /v1/config/*` / `GET /v1/market/leaderboard`
- `GET /`（landing 页面）
- `GET /view/*` / `GET /v1/views/*`
- `GET /metrics` / `GET /v1/metrics`
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add rate limit section with IETF headers"
```

---

## Task 14: Update `docs/superpowers/openapi.json` — headers + 429 schema

**Files:**
- Modify: `docs/superpowers/openapi.json`

This task adds the `RateLimit-*` headers and a 429 response schema to each protected endpoint. Because the file is large and many endpoints share the same pattern, we write a small Node script to apply the change consistently.

- [ ] **Step 1: Write a one-time patching script**

Create `tmp/patch-openapi.js` (gitignored):

```javascript
// tmp/patch-openapi.js
// Run: node tmp/patch-openapi.js
// One-time script: adds RateLimit-* headers + 429 response to every protected endpoint in openapi.json.
const fs = require('node:fs');
const path = require('node:path');

const OPENAPI_PATH = path.join(__dirname, '../docs/superpowers/openapi.json');
const PROTECTED_PREFIXES = ['/v1/users/', '/v1/headhunter', '/v1/employer', '/v1/candidate'];

const openapi = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));

const limitHeader = {
  description: 'IETF draft-ietf-httpapi-ratelimit-headers. Per-window upper limit, ordered 1s/60s/3600s.',
  schema: { type: 'string', example: '20, 100, 750' },
};
const remainingHeader = {
  description: 'Per-window remaining quota, ordered 1s/60s/3600s.',
  schema: { type: 'string', example: '18, 98, 745' },
};
const resetHeader = {
  description: 'Per-window seconds until reset, ordered 1s/60s/3600s.',
  schema: { type: 'string', example: '1, 45, 2105' },
};
const retryAfterHeader = {
  description: 'Seconds to wait before retrying. Conservative (max of 3 windows).',
  schema: { type: 'integer', example: 2105 },
};
const rateLimitedResponse = {
  description: 'Rate limit exceeded',
  headers: {
    'RateLimit-Limit': limitHeader,
    'RateLimit-Remaining': remainingHeader,
    'RateLimit-Reset': resetHeader,
    'Retry-After': retryAfterHeader,
  },
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/RateLimitedError' },
    },
  },
};

for (const [pathKey, pathItem] of Object.entries(openapi.paths || {})) {
  const isProtected = PROTECTED_PREFIXES.some(p => pathKey === p || pathKey.startsWith(p + '/') || pathKey.startsWith(p));
  if (!isProtected) continue;
  for (const [method, op] of Object.entries(pathItem)) {
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
    if (!op.responses) continue;

    // Add headers to 2xx
    for (const [code, response] of Object.entries(op.responses)) {
      if (code.startsWith('2')) {
        response.headers = {
          ...(response.headers || {}),
          'RateLimit-Limit': limitHeader,
          'RateLimit-Remaining': remainingHeader,
          'RateLimit-Reset': resetHeader,
        };
      }
    }
    // Add 429 response
    op.responses['429'] = rateLimitedResponse;
  }
}

// Ensure RateLimitedError schema exists
openapi.components = openapi.components || {};
openapi.components.schemas = openapi.components.schemas || {};
openapi.components.schemas.RateLimitedError = {
  type: 'object',
  required: ['ok', 'error'],
  properties: {
    ok: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', enum: ['RATE_LIMITED'] },
        message: { type: 'string' },
        details: {
          type: 'object',
          properties: {
            violated_window: { type: 'string', enum: ['second', 'minute', 'hour'] },
            retry_after_seconds: { type: 'integer' },
          },
        },
      },
    },
  },
};

fs.writeFileSync(OPENAPI_PATH, JSON.stringify(openapi, null, 2) + '\n');
console.log('Updated openapi.json with RateLimit-* headers + 429 schema.');
```

- [ ] **Step 2: Run the script**

Run:
```bash
cd D:\dev\hunter-platform
node tmp/patch-openapi.js
```

Expected: `Updated openapi.json with RateLimit-* headers + 429 schema.`

- [ ] **Step 3: Verify the openapi tests still pass**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test -- tests/integration/openapi.test.ts
```

Expected: PASS.

- [ ] **Step 4: Delete the patch script (it's a one-off)**

Run:
```bash
cd D:\dev\hunter-platform
rm tmp/patch-openapi.js
```

- [ ] **Step 5: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/superpowers/openapi.json
git commit -m "docs(openapi): add RateLimit-* headers + 429 schema to protected endpoints"
```

---

## Task 15: Update `docs/CHANGELOG.md`

**Files:**
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: Check if CHANGELOG.md exists**

Run:
```bash
cd D:\dev\hunter-platform
ls docs/CHANGELOG.md 2>&1
```

If it exists, edit it; otherwise create a new one.

- [ ] **Step 2: Add a new entry at the top**

Add the following section at the top of the file (preserve existing entries below):

```markdown
## v0.3.0 — Rate Limit Redesign (2026-06-19)

**Breaking change for Agent 集成方**: 限流算法从 fixed-window 改为 sliding-window-counter。

- 1h 阈值上调 1.5x（candidate 200→300、headhunter 500→750、employer 800→1200）
- 所有认证响应新增 IETF `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers
- 任一窗口 remaining < 20% 时新增 `RateLimit-Policy: warn` 头
- 429 响应 `Retry-After` 字段始终存在
- 撞限后能渐进恢复，不再"锁一整窗口"

**Action required**: 客户端应主动读 `RateLimit-Remaining` 头进行节流；收到 429 时严格按 `Retry-After` 重试。

完整文档：[docs/superpowers/skill.md](../superpowers/skill.md) 的"限流"章节。

---
```

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add docs/CHANGELOG.md
git commit -m "docs(changelog): v0.3.0 rate limit redesign"
```

---

## Task 16: Extend k6 load test for recovery behavior

**Files:**
- Modify: `tests/load/rate-limit.js`

- [ ] **Step 1: Add a recovery scenario to the k6 script**

Replace the entire contents of `tests/load/rate-limit.js` with:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;

export const options = {
  scenarios: {
    burst_1s: {
      executor: 'constant-arrival-rate',
      rate: 200, // far above the 1s bucket limit (headhunter=20)
      timeUnit: '1s',
      duration: '5s',
      preAllocatedVUs: 5,
    },
    recovery_after_429: {
      executor: 'constant-vus',
      vus: 1,
      duration: '70s',
      startTime: '10s',  // begin after burst
    },
  },
};

export default function () {
  const res = http.get(`${BASE}/v1/users/me/status`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has RateLimit-Remaining': (r) => r.headers['RateLimit-Remaining'] !== undefined,
    'has Retry-After on 429': (r) => r.status === 200 || r.headers['Retry-After'] !== undefined,
  });
  if (res.status === 429) sleep(1);
}
```

- [ ] **Step 2: Smoke-test the script syntactically (don't actually run k6 here)**

Run:
```bash
cd D:\dev\hunter-platform
node --check tests/load/rate-limit.js
```

Expected: no errors (this validates ES module syntax; k6 is a separate runtime).

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add tests/load/rate-limit.js
git commit -m "test(load): add recovery scenario to k6 rate-limit test"
```

---

## Task 17: Final verification — all tests pass

**Files:** none (read-only verification)

- [ ] **Step 1: Run full test suite**

Run:
```bash
cd D:\dev\hunter-platform
pnpm test
```

Expected: ALL tests PASS. Watch for any flakiness in the rate-limit integration tests due to the 1s window timing (use `vi.useFakeTimers()` if needed, or accept some variance).

- [ ] **Step 2: Run typecheck**

Run:
```bash
cd D:\dev\hunter-platform
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Smoke-test the API server**

Start the dev server:
```bash
cd D:\dev\hunter-platform
pnpm api:dev
```

In another terminal:
```bash
# Register a user
curl -sS -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"user_type":"headhunter","name":"Smoke","contact":"smoke@x.com"}'

# Use the returned api_key
curl -isS http://localhost:3000/v1/users/me/status \
  -H "Authorization: Bearer hp_live_xxx" | head -20
```

Expected: response includes `RateLimit-Limit: 20, 100, 750` header.

- [ ] **Step 4: Update todo and report completion**

Mark all 9 brainstorming todos complete and report the spec + plan are done. Implementation is ready to be executed via `subagent-driven-development` or `executing-plans`.
