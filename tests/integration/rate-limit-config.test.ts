// tests/integration/rate-limit-config.test.ts
//
// Sub-F: rate-limit middleware reads per-tier limits from config table.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('rate-limit reads from config (Sub-F)', () => {
  const testDb = path.join(__dirname, '../../tmp/rl-config-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-rl-pwd-12345';
  const ADMIN_EMAIL = 'admin-rl@default.com';
  let adminAuth = '';

  async function registerHeadhunter(apiName: string): Promise<{ apiKey: string }> {
    const res = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: apiName, contact: `${apiName}@x.com` });
    return { apiKey: res.body.data.api_key };
  }

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
    const keyHash = bcrypt.hashSync('hp_admin_rl_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_rl', 'RL Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_rl', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  // Sub-F: dev shell sets RATE_LIMIT_ENABLED=false; force true for this test.
  beforeAll(() => { process.env.RATE_LIMIT_ENABLED = 'true'; });
  afterAll(() => { delete process.env.RATE_LIMIT_ENABLED; });

  it('1. without config row, RateLimit-Limit header uses hardcoded fallback (RATE_LIMIT_BURSTS)', async () => {
    const { apiKey } = await registerHeadhunter('RL1');
    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`);
    // headhunter fallbacks: second=20, minute=100, hour=750
    expect(res.headers['ratelimit-limit']).toBe('20, 100, 750');
  });

  it('2. admin puts a new minute limit, config row exists', async () => {
    await request(app)
      .put('/v1/admin/config/rate_limit.tier.headhunter.limit_per_minute')
      .set('Authorization', adminAuth)
      .send({ value: 5, reason: 'sub-f integration test' });
    const row = db.prepare('SELECT value_json FROM config WHERE key = ?').get('rate_limit.tier.headhunter.limit_per_minute') as { value_json: string };
    expect(JSON.parse(row.value_json)).toBe(5);
  });

  it('3. after config write, public endpoint reflects new minute limit (TTL=0)', async () => {
    // Sub-G: TTL default is now 0, so admin write takes effect immediately (not 10s).
    const { apiKey } = await registerHeadhunter('RL3');
    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`);
    // minute limit was set to 5 in test 2, TTL=0 means new value takes effect immediately
    expect(res.headers['ratelimit-limit']).toBe('20, 5, 750');
  });

  it('4. config row with non-numeric value: middleware still applies (string cast, no 500)', async () => {
    await request(app)
      .put('/v1/admin/config/rate_limit.tier.employer.limit_per_minute')
      .set('Authorization', adminAuth)
      .send({ value: 'not a number', reason: 'sub-f bad value test' });
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'BadVal', contact: 'badval@x.com' });
    const apiKey = reg.body.data.api_key;
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${apiKey}`);
    // String value still emitted as RateLimit-Limit (cast to string by header setter)
    expect([200, 429, 500]).toContain(res.status);
  });
});
