// tests/integration/industry-map-config.test.ts
//
// Sub-F: industry_map loader reads from config table. Fallback to file readFileSync
// (preserves dev behavior when DB has no key).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { __resetIndustryCacheForTests } from '../../src/main/modules/desensitize/mapping';

describe('industry_map reads from config (Sub-F)', () => {
  const testDb = path.join(__dirname, '../../tmp/industry-config-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-ind-pwd-12345';
  const ADMIN_EMAIL = 'admin-ind@default.com';
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
    const keyHash = bcrypt.hashSync('hp_admin_ind_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_ind', 'Ind Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_ind', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  beforeEach(() => { __resetIndustryCacheForTests(); });
  afterAll(() => { if (db) db.close(); });

  it('1. GET /v1/config/industries works (falls back to file when DB empty)', async () => {
    const res = await request(app).get('/v1/config/industries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('2. admin puts new industry_map; DB has the value', async () => {
    const res = await request(app)
      .put('/v1/admin/config/industry_map')
      .set('Authorization', adminAuth)
      .send({
        value: {
          version: 1,
          updated_at: '2026-06-26',
          categories: [{ id: 'TestCategory', companies: ['TestCo'] }],
          fallback_keywords: {},
          default: 'TestCategory',
        },
        reason: 'sub-f test',
      });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT value_json FROM config WHERE key = ?').get('industry_map') as { value_json: string };
    expect(JSON.parse(row.value_json).categories[0].id).toBe('TestCategory');
  });

  it('3. industry_map response shape is well-formed', async () => {
    const res = await request(app).get('/v1/config/industries');
    for (const cat of res.body.data) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('companies_count');
      expect(typeof cat.companies_count).toBe('number');
    }
  });
});
