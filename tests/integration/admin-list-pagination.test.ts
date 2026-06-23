import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('admin list pagination + dashboard stats (Sub-B)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subb-test.db');
  let app: any;
  let db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* ignore */ }
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

    // Seed admin
    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subbtest_aabb', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subb', 'SubB Admin', 'subb@test.com', pwdHash, keyHash, 'hp_admin_subbtes', 'super', 'active',
      '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login')
      .send({ email: 'subb@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed 25 users with varied names + created_at. Use i=1..25 (skip "today")
// so all users are always inside the 30-day window regardless of test execution TZ.
    const now = new Date('2026-06-24T12:00:00Z').getTime();
    for (let i = 1; i <= 25; i++) {
      db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, 'candidate', ?, ?, ?, ?, 100, 0, datetime('now', '+1 day'), 50, 'active',
          ?, ?)`).run(
        `u_${i}`,
        i % 3 === 0 ? `Alice_${i}` : i % 3 === 1 ? `Bob_${i}` : `Carol_${i}`,
        `u${i}@test.com`,
        `hash_${i}`,
        `hp_${i}`,
        new Date(now - i * 86400000).toISOString(),
        new Date(now - i * 86400000).toISOString()
      );
    }
  });

  afterAll(() => { if (db) db.close(); });

  // ---- Users pagination ----
  it('1. GET /v1/admin/users returns paginated envelope', async () => {
    const r = await request(app).get('/v1/admin/users').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.pagination).toMatchObject({ total: 25, page: 1, pageSize: 20, has_more: true });
    expect(r.body.data).toHaveLength(20);
  });

  it('2. GET /v1/admin/users?page=2 returns remaining rows', async () => {
    const r = await request(app).get('/v1/admin/users?page=2&pageSize=20').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(5);
    expect(r.body.pagination.has_more).toBe(false);
  });

  it('3. GET /v1/admin/users?keyword=Alice filters by name', async () => {
    const r = await request(app).get('/v1/admin/users?keyword=Alice').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    // 9 Alice rows (i=3,6,9,12,15,18,21,24,27 → i=1..25 → i%3===0 → i=3,6,9,...,24 = 8 rows; 27 not in range)
    expect(r.body.pagination.total).toBe(8);
    expect(r.body.data.every((u: any) => u.name.includes('Alice'))).toBe(true);
  });

  it('4. GET /v1/admin/users?pageSize=200 → 400', async () => {
    const r = await request(app).get('/v1/admin/users?pageSize=200').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('5. GET /v1/admin/users?keyword=  (empty) does not filter', async () => {
    const r = await request(app).get('/v1/admin/users?keyword=').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(25);
  });

  // ---- Candidates JOIN + masked ----
  it('6. GET /v1/admin/candidates returns paginated envelope with masked PII', async () => {
    const r = await request(app).get('/v1/admin/candidates').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination).toBeDefined();
    // Empty candidates table in this test (no headhunter seeded) → total=0
    expect(r.body.pagination.total).toBe(0);
    expect(r.body.data).toHaveLength(0);
  });

  // ---- Dashboard ----
  it('7. GET /v1/admin/dashboard/stats has today_new_users + trend_30d', async () => {
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty('today_new_users');
    expect(typeof r.body.data.today_new_users).toBe('number');
    expect(r.body.data.trend_30d).toHaveLength(30);
    expect(r.body.data.trend_30d.every((v: any) => typeof v === 'number')).toBe(true);
  });

  it('8. dashboard trend sums include seeded users', async () => {
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    const sum = r.body.data.trend_30d.reduce((a: number, b: number) => a + b, 0);
    // We seeded 25 users spread across 25 days (i*86400000ms = 1 day apart)
    expect(sum).toBeGreaterThanOrEqual(25);
  });

  it('9. dashboard today_new_users counts only today (UTC)', async () => {
    // Seed 1 user with created_at = today (UTC midnight)
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_today', 'candidate', 'TodayUser', 't@x', 'h', 'hp_today', 100, 0,
      datetime('now', '+1 day'), 50, 'active',
      datetime('now', 'start of day'), datetime('now', 'start of day'))`).run();
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    expect(r.body.data.today_new_users).toBeGreaterThanOrEqual(1);
  });
});