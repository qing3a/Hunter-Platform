// tests/integration/rate-limit-public.test.ts
//
// Sub-G: GET /v1/config/rate-limits is a public endpoint (optional auth) that
// returns the current per-tier rate-limit thresholds so agents can pre-read.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/config/rate-limits (Sub-G public endpoint)', () => {
  const testDb = path.join(__dirname, '../../tmp/rate-limit-public-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-rlp-pwd-12345';
  const ADMIN_EMAIL = 'admin-rlp@default.com';
  let adminAuth = '';

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_rlp_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_rlp', 'RLP Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_rlp', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('1. public endpoint returns 200 with complete shape (no auth)', async () => {
    const res = await request(app).get('/v1/config/rate-limits');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.tiers).toEqual({
      candidate:  { second: 10, minute: 50,  hour: 300 },
      hr:         { second: 20, minute: 100, hour: 750 },  // R1.C2: was 'hr'
      pm:         { second: 30, minute: 200, hour: 1200 },  // R1.C2: was 'pm'
    });
    expect(res.body.data.windows).toEqual(['second', 'minute', 'hour']);
  });

  it('2. admin put new limit, public endpoint reflects new value (TTL=0)', async () => {
    await request(app)
      .put('/v1/admin/config/rate_limit.tier.hr.limit_per_minute')  // R1.C2: was 'hr'
      .set('Authorization', adminAuth)
      .send({ value: 200, reason: 'sub-g public test' });
    const res = await request(app).get('/v1/config/rate-limits');
    expect(res.status).toBe(200);
    expect(res.body.data.tiers.hr.minute).toBe(200);  // R1.C2: was 'hr'
  });

  it('3. unauthenticated request still works (optional auth, not strict)', async () => {
    // The endpoint is /v1/config/* → optionalAuthMiddleware → no 401 on missing auth.
    const res = await request(app).get('/v1/config/rate-limits');
    expect(res.status).toBe(200);
  });
});
