import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('rate limit bucket', () => {
  const testDb = path.join(__dirname, '../../tmp/rl.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createRateLimit } = await import('../../src/main/modules/rate-limit/bucket');
    (globalThis as any).__rlTestDb = db;
    (globalThis as any).__rlTest = createRateLimit(db);
  });
  afterEach(() => {
    const db = (globalThis as any).__rlTestDb;
    db.close();
    try { fs.unlinkSync(testDb); } catch {}
  });

  it('allows requests under limit', () => {
    const rl = (globalThis as any).__rlTest;
    const result = rl.check('user_1', [{ windowSeconds: 60, limit: 10 }]);
    expect(result.allowed).toBe(true);
  });

  it('rejects when over limit', () => {
    const rl = (globalThis as any).__rlTest;
    for (let i = 0; i < 10; i++) rl.check('user_2', [{ windowSeconds: 60, limit: 10 }]);
    const result = rl.check('user_2', [{ windowSeconds: 60, limit: 10 }]);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('RATE_LIMITED');
  });

  it('supports IP-style user_id (no user record needed)', () => {
    const rl = (globalThis as any).__rlTest;
    const result = rl.check('ip:1.2.3.4', [{ windowSeconds: 60, limit: 5 }]);
    expect(result.allowed).toBe(true);
  });
});
