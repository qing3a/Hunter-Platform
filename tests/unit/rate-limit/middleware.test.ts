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

  // IMPORTANT: Isolate RATE_LIMIT_ENABLED from the surrounding shell environment.
  // The project's .env file sets RATE_LIMIT_ENABLED=false for dev convenience, but
  // some shells (MINGW64 bash, fish with auto-source, etc.) propagate that env var
  // into vitest child processes. The kill-switch branch in middleware.ts short-
  // circuits BEFORE any real rate-limit logic, so the top-level tests below would
  // silently emit unlimited headers and never reach the 429/soft-warning/req.user/
  // DB fail-open paths they assert on.
  //
  // Pattern: the kill-switch `describe` block at the bottom of this file already
  // saves/restores this env var per-test; we apply the same isolation at the
  // outer level so the non-kill-switch tests are deterministic.
  const originalEnv = process.env.RATE_LIMIT_ENABLED;

  beforeEach(() => {
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    db = openDb(testDbPath);
    runMigrations(db);
    process.env.RATE_LIMIT_ENABLED = 'true';
  });
  afterEach(() => {
    db.close();
    try { fs.unlinkSync(testDbPath); } catch { /* ignore */ }
    if (originalEnv === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = originalEnv;
  });

  it('allows request under limit and calls next() with headers set', () => {
    const mw = createRateLimitMiddleware(db);
    const req = { user: candidate, headers: {} } as any;
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
    const req = { user: candidate, headers: {} } as any;
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
    const req = { user: candidate, headers: {} } as any;
    const res = fakeRes();
    mw(req, res, () => {});
    expect(res.headers['RateLimit-Policy']).toBe('warn');
    expect(res.headers['X-RateLimit-Warning']).toContain('hour');
  });

  it('returns 401-style error when req.user is missing', () => {
    const mw = createRateLimitMiddleware(db);
    const req = { headers: {} } as any;
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
    const req = { user: candidate, headers: {} } as any;
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);   // fail-open: do not block
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('rate-limit DB error'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  describe('kill switch emits unlimited headers (Bug 2)', () => {
    const originalEnv = process.env.RATE_LIMIT_ENABLED;

    afterEach(() => {
      if (originalEnv === undefined) delete process.env.RATE_LIMIT_ENABLED;
      else process.env.RATE_LIMIT_ENABLED = originalEnv;
    });

    it('emits RateLimit-Limit=-1 + RateLimit-Policy=unlimited when RATE_LIMIT_ENABLED=false', () => {
      process.env.RATE_LIMIT_ENABLED = 'false';
      const mw = createRateLimitMiddleware(db);
      const req = { user: candidate, headers: {} } as any;
      const res = fakeRes();
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['RateLimit-Limit']).toBe('-1');
      expect(res.headers['RateLimit-Remaining']).toBe('-1');
      expect(res.headers['RateLimit-Reset']).toBe('0');
      expect(res.headers['RateLimit-Policy']).toBe('unlimited');
    });

    it('emits unlimited headers when X-RateLimit-Skip=1', () => {
      const mw = createRateLimitMiddleware(db);
      const req = { user: candidate, headers: { 'x-ratelimit-skip': '1' } } as any;
      const res = fakeRes();
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['RateLimit-Limit']).toBe('-1');
      expect(res.headers['RateLimit-Remaining']).toBe('-1');
      expect(res.headers['RateLimit-Reset']).toBe('0');
      expect(res.headers['RateLimit-Policy']).toBe('unlimited');
    });

    it('still emits real (non-unlimited) headers when RATE_LIMIT_ENABLED=true', () => {
      process.env.RATE_LIMIT_ENABLED = 'true';
      const mw = createRateLimitMiddleware(db);
      const req = { user: candidate, headers: {} } as any;
      const res = fakeRes();
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['RateLimit-Limit']).toBe('10, 50, 300');
      expect(res.headers['RateLimit-Policy']).toBeUndefined();
    });
  });
});
