// tests/integration/commission-config.test.ts
//
// Sub-G: commission handler reads `commission.platform_rate` from config table.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('commission handler reads from config (Sub-G)', () => {
  const testDb = path.join(__dirname, '../../tmp/commission-config-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-cfg-pwd-12345';
  const ADMIN_EMAIL = 'admin-cfg@default.com';
  let adminAuth = '';

  beforeAll(async () => {
    [testDb, testDb + '-wal', testDb + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = 'DEPRECATED';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb, migrateConfigFromFilesToDB } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    migrateConfigFromFilesToDB(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync(ADMIN_PWD, 4);
    const keyHash = bcrypt.hashSync('hp_admin_cfg_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_cfg', 'Cfg Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_cfg', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('1. migrate seeds default commission.platform_rate = 0.1', async () => {
    // After beforeAll's runMigrations + migrate, commission.platform_rate should be in DB
    const row = db.prepare('SELECT value_json FROM config WHERE key = ?').get('commission.platform_rate') as { value_json: string };
    expect(row).toBeTruthy();
    expect(JSON.parse(row.value_json)).toBe(0.1);
  });

  it('2. admin put new rate, DB has the value (handler picks it up via TTL=0)', async () => {
    const res = await request(app)
      .put('/v1/admin/config/commission.platform_rate')
      .set('Authorization', adminAuth)
      .send({ value: 0.15, reason: 'sub-g test' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT value_json FROM config WHERE key = ?').get('commission.platform_rate') as { value_json: string };
    expect(JSON.parse(row.value_json)).toBe(0.15);
  });

  it('3. PUT with value > 1 is rejected (Zod 0-1 validation)', async () => {
    const res = await request(app)
      .put('/v1/admin/config/commission.platform_rate')
      .set('Authorization', adminAuth)
      .send({ value: 1.5, reason: 'should reject' });
    expect(res.status).toBe(400);
  });
});
