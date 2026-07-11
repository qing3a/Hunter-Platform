import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('idempotency middleware', () => {
  const testDb = path.join(__dirname, '../../tmp/idem.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const users = createUsersRepo(db);
    users.insert({
      id: 'u1', user_type: 'hr', name: 'A', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0,
      quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    const { createIdempotencyMiddleware } = await import('../../src/main/modules/idempotency/middleware');
    (globalThis as any).__idemTestDb = db;
    (globalThis as any).__idemTestMw = createIdempotencyMiddleware(db);
  });
  afterEach(() => {
    const db = (globalThis as any).__idemTestDb;
    db.close();
    try { fs.unlinkSync(testDb); } catch {}
  });

  it('returns cached response on duplicate', () => {
    const mw = (globalThis as any).__idemTestMw;
    const key = 'idem-key-1';
    const body = JSON.stringify({ foo: 'bar' });
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const r1 = mw.processOrCache(key, 'u1', hash, 200, JSON.stringify({ ok: true, data: { id: 1 } }));
    expect(r1.cacheHit).toBe(false);
    const r2 = mw.processOrCache(key, 'u1', hash, 200, JSON.stringify({ ok: true, data: { id: 2 } }));
    expect(r2.cacheHit).toBe(true);
    expect(JSON.parse(r2.body)).toEqual({ ok: true, data: { id: 1 } });
  });

  it('returns DUPLICATE_REQUEST on different body with same key', () => {
    const mw = (globalThis as any).__idemTestMw;
    const key = 'idem-key-2';
    const r1 = mw.processOrCache(key, 'u1', 'hash1', 200, '{}');
    const r2 = mw.processOrCache(key, 'u1', 'hash2', 200, '{}');
    expect(r2.duplicate).toBe(true);
  });
});
