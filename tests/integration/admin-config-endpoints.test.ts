// tests/integration/admin-config-endpoints.test.ts
//
// Sub-E Config DB-backed — exhaustive integration tests for /v1/admin/config
// (GET list) and /v1/admin/config/:key (PUT upsert). Covers:
//   - List returns empty array for fresh DB
//   - PUT with reason persists + writes admin_action_log
//   - PUT without reason → 400
//   - PUT with reason < 3 chars → 400
//   - PUT with invalid key format (uppercase / starts with digit / no dot) → 400
//   - PUT upserts existing key (audit shows update)
//   - GET after PUT returns the entry
//   - Non-admin caller → 401
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin config endpoints (Sub-E: DB-backed)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-config-test.db');
  let app: any;
  let db: any;
  const ADMIN_PWD = 'admin-test-pwd-config';
  const ADMIN_EMAIL = 'admin-config@default.com';
  let adminAuth = '';

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
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
    const keyHash = bcrypt.hashSync('hp_admin_legacykey_bbbb', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_cfg', 'Config Admin', ADMIN_EMAIL, pwdHash, keyHash, 'hp_admin_cfg', 'super', 'active',
      '2026-06-26T00:00:00Z', '2026-06-26T00:00:00Z'
    );
    const loginResp = await request(app).post('/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PWD });
    adminAuth = `Bearer ${loginResp.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('1. GET /v1/admin/config returns empty array for fresh DB', async () => {
    const res = await request(app).get('/v1/admin/config').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it('2. PUT /v1/admin/config/:key with valid reason persists and writes audit log', async () => {
    const res = await request(app)
      .put('/v1/admin/config/platform.fee.pct')
      .set('Authorization', adminAuth)
      .send({ value: 5, reason: 'sub-e integration test' });
    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe('platform.fee.pct');
    expect(res.body.data.value).toBe(5);

    // Verify the row landed in DB
    const row = db.prepare('SELECT * FROM config WHERE key = ?').get('platform.fee.pct') as any;
    expect(row).toBeTruthy();
    expect(JSON.parse(row.value_json)).toBe(5);

    // Verify admin_action_log entry was written with the reason
    const audit = db.prepare(
      "SELECT * FROM admin_action_log WHERE target_id = ? AND action = 'update_config'"
    ).get('platform.fee.pct') as any;
    expect(audit).toBeTruthy();
    const details = JSON.parse(audit.details_json);
    expect(details.value).toBe(5);
    expect(details.reason).toBe('sub-e integration test');
  });

  it('3. PUT without reason → 400 INVALID_PARAMS', async () => {
    const res = await request(app)
      .put('/v1/admin/config/platform.fee.pct')
      .set('Authorization', adminAuth)
      .send({ value: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/reason/i);
  });

  it('4. PUT with reason shorter than 3 chars → 400', async () => {
    const res = await request(app)
      .put('/v1/admin/config/platform.fee.pct')
      .set('Authorization', adminAuth)
      .send({ value: 7, reason: 'no' });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/reason/i);
  });

  it('5. PUT with invalid key format (uppercase) → 400', async () => {
    const res = await request(app)
      .put('/v1/admin/config/Invalid.Key')
      .set('Authorization', adminAuth)
      .send({ value: 1, reason: 'should reject uppercase' });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toMatch(/key format/i);
  });

  it('6. PUT with key starting with digit → 400', async () => {
    const res = await request(app)
      .put('/v1/admin/config/1platform.fee')
      .set('Authorization', adminAuth)
      .send({ value: 1, reason: 'digit prefix should fail' });
    expect(res.status).toBe(400);
  });

  it('7. PUT upserts existing key (overwrites value, writes new audit row)', async () => {
    // First write
    await request(app)
      .put('/v1/admin/config/rate_limit.tier.free.limit_per_minute')
      .set('Authorization', adminAuth)
      .send({ value: 10, reason: 'initial rate limit' });
    // Second write — should upsert
    const res = await request(app)
      .put('/v1/admin/config/rate_limit.tier.free.limit_per_minute')
      .set('Authorization', adminAuth)
      .send({ value: 20, reason: 'increased rate limit' });
    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe(20);

    // Two audit rows for the same key
    const audits = db.prepare(
      "SELECT * FROM admin_action_log WHERE target_id = ? AND action = 'update_config' ORDER BY created_at"
    ).all('rate_limit.tier.free.limit_per_minute') as any[];
    expect(audits).toHaveLength(2);
    expect(JSON.parse(audits[0].details_json).value).toBe(10);
    expect(JSON.parse(audits[1].details_json).value).toBe(20);

    // Single row in config (not duplicated)
    const rows = db.prepare('SELECT * FROM config WHERE key = ?').all('rate_limit.tier.free.limit_per_minute') as any[];
    expect(rows).toHaveLength(1);
  });

  it('8. GET after PUTs returns all entries', async () => {
    const res = await request(app).get('/v1/admin/config').set('Authorization', adminAuth);
    expect(res.status).toBe(200);
    const keys = (res.body.data as any[]).map((e) => e.key).sort();
    expect(keys).toContain('platform.fee.pct');
    expect(keys).toContain('rate_limit.tier.free.limit_per_minute');
  });

  it('9. GET without admin auth → 401', async () => {
    const res = await request(app).get('/v1/admin/config');
    expect(res.status).toBe(401);
  });

  it('10. PUT without admin auth → 401', async () => {
    const res = await request(app)
      .put('/v1/admin/config/platform.fee.pct')
      .send({ value: 1, reason: 'no auth' });
    expect(res.status).toBe(401);
  });
});
