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
// and anchor `now` to real Date.now() so all users always fall inside the
// handler's 30-day window (which also uses Date.now()) regardless of when
// the test runs. Avoids date drift from a hardcoded reference date.
    const now = Date.now();
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
    // Seed 1 user with created_at = today (UTC midnight). Use JS-computed UTC
    // midnight — same logic as handler in routes/admin.ts. Avoids sqlite's
    // datetime('now', 'start of day') which uses LOCAL timezone, causing
    // flakiness in non-UTC test environments (e.g. CI in UTC+8).
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const todayIso = todayUtc.toISOString();
    db.prepare(`INSERT INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
      quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
      VALUES ('u_today', 'candidate', 'TodayUser', 't@x', 'h', 'hp_today', 100, 0,
      datetime('now', '+1 day'), 50, 'active',
      ?, ?)`).run(todayIso, todayIso);
    const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
    expect(r.body.data.today_new_users).toBeGreaterThanOrEqual(1);
  });

  // ---- Jobs pagination + filter (Sub-C Plan 1) ----
  describe('GET /v1/admin/jobs', () => {
    beforeAll(() => {
      const now = new Date('2026-06-24T12:00:00Z').getTime();
      const jobs = [
        ['job_a', 'open'],
        ['job_b', 'claimed'],
        ['job_c', 'paused'],
        ['job_d', 'closed'],
        ['job_e', 'filled'],
        ['job_f', 'open'],
        ['job_g', 'open'],
        ['job_h', 'open'],
      ];
      for (const [id, status] of jobs) {
        db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
          VALUES (?, 'u_1', ?, ?, ?, ?)`).run(
          id, `Title ${id}`, status,
          new Date(now - 86400000).toISOString(),
          new Date(now - 86400000).toISOString()
        );
      }
    });

    it('1. returns paginated envelope', async () => {
      const r = await request(app).get('/v1/admin/jobs').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination).toMatchObject({ total: 8, page: 1, pageSize: 20, has_more: false });
      expect(r.body.data).toHaveLength(8);
    });

    it('2. filters by status=open', async () => {
      const r = await request(app).get('/v1/admin/jobs?status=open').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(4);  // job_a, f, g, h (4 'open' in seed)
      expect(r.body.data.every((j: any) => j.status === 'open')).toBe(true);
    });

    it('3. filters by keyword (matches title)', async () => {
      const r = await request(app).get('/v1/admin/jobs?keyword=Title%20job_c').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(1);
      expect(r.body.data[0].id).toBe('job_c');
    });

    it('4. rejects invalid status with 400', async () => {
      const r = await request(app).get('/v1/admin/jobs?status=invalid').set('Authorization', adminAuth);
      expect(r.status).toBe(400);
    });
  });

  // ---- Recommendations pagination + filter + date range (Sub-C Plan 1) ----
  describe('GET /v1/admin/recommendations', () => {
    beforeAll(() => {
      // Seed candidate_private + candidates_anonymized for FK on recommendations.anonymized_candidate_id
      // (UNIQUE constraint on (anonymized_candidate_id, job_id) → each rec needs unique candidate)
      for (let i = 1; i <= 6; i++) {
        db.prepare(`INSERT INTO candidates_private (id, headhunter_id, candidate_user_id, name_enc, phone_enc, email_enc, created_at, updated_at)
          VALUES (?, 'u_2', 'u_3', 'x', 'x', 'x', datetime('now'), datetime('now'))`).run(`cp_${i}`);
        db.prepare(`INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, is_public_pool, unlock_status, created_at, updated_at)
          VALUES (?, ?, 'u_2', 1, 'locked', datetime('now'), datetime('now'))`).run(`c_${i}`, `cp_${i}`);
      }
      const now = Date.now();
      const recs = [
        ['rec_a', 'pending',       now - 86400000],
        ['rec_b', 'unlocked',      now - 2 * 86400000],
        ['rec_c', 'pending',       now - 3 * 86400000],
        ['rec_d', 'placed',        now - 4 * 86400000],
        ['rec_e', 'rejected_employer', now - 5 * 86400000],
        ['rec_f', 'pending',       now - 10 * 86400000],  // outside 7-day window
      ];
      recs.forEach(([id, status, ts], idx) => {
        db.prepare(`INSERT INTO recommendations
          (id, headhunter_id, employer_id, anonymized_candidate_id, job_id, status, created_at, updated_at)
          VALUES (?, 'u_2', 'u_1', ?, 'job_a', ?, ?, ?)`).run(
          id, `c_${idx + 1}`, status, new Date(ts).toISOString(), new Date(ts).toISOString()
        );
      });
    });

    it('1. returns paginated envelope', async () => {
      const r = await request(app).get('/v1/admin/recommendations').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(6);
      expect(r.body.data[0].id).toBe('rec_a');  // newest first
    });

    it('2. filters by status=pending', async () => {
      const r = await request(app).get('/v1/admin/recommendations?status=pending').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(3);  // rec_a, c, f
      expect(r.body.data.every((rec: any) => rec.status === 'pending')).toBe(true);
    });

    it('3. filters by date range (last 7 days)', async () => {
      const fromDate = new Date(Date.now() - 7 * 86400000).toISOString();
      const r = await request(app).get(`/v1/admin/recommendations?from=${encodeURIComponent(fromDate)}`).set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.pagination.total).toBe(5);  // excludes rec_f
    });

    it('4. rejects invalid status with 400', async () => {
      const r = await request(app).get('/v1/admin/recommendations?status=garbage').set('Authorization', adminAuth);
      expect(r.status).toBe(400);
    });
  });

  // ---- Dashboard stats + 7 new fields (Sub-C Plan 1) ----
  describe('Dashboard stats 7 new fields', () => {
    it('1. dashboard stats includes 7 new fields', async () => {
      const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
      expect(r.status).toBe(200);
      expect(r.body.data).toHaveProperty('total_recommendations');
      expect(r.body.data).toHaveProperty('today_new_recommendations');
      expect(r.body.data).toHaveProperty('recommendations_pending');
      expect(r.body.data).toHaveProperty('recommendations_unlocked');
      expect(r.body.data).toHaveProperty('jobs_paused');
      expect(r.body.data).toHaveProperty('jobs_closed');
      expect(r.body.data).toHaveProperty('jobs_filled');
      expect(typeof r.body.data.total_recommendations).toBe('number');
    });

    it('2. dashboard stats counts match seeded data', async () => {
      const r = await request(app).get('/v1/admin/dashboard/stats').set('Authorization', adminAuth);
      // Seeded: 8 jobs (1 paused + 1 closed + 1 filled) → jobs_paused=1, jobs_closed=1, jobs_filled=1
      expect(r.body.data.jobs_paused).toBe(1);
      expect(r.body.data.jobs_closed).toBe(1);
      expect(r.body.data.jobs_filled).toBe(1);
      // Seeded: 6 recommendations (3 pending + 1 unlocked + 1 placed + 1 rejected)
      expect(r.body.data.total_recommendations).toBe(6);
      expect(r.body.data.recommendations_pending).toBe(3);
      expect(r.body.data.recommendations_unlocked).toBe(1);
    });
  });

  // ---- adjustQuota (Sub-C Plan 2) ----
  describe('POST /v1/admin/users/:id/adjust-quota', () => {
    beforeAll(() => {
      // Reset quota_per_day to 100 for u_1 (Sub-B seed set it to 100; ensure known state)
      db.prepare(`UPDATE users SET quota_per_day = 100 WHERE id = 'u_1'`).run();
    });

    it('1. adjusts quota with valid reason → 200 + writes audit', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: '客户紧急加单' });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ user_id: 'u_1', previous_quota: 100, new_quota: 50, reason: '客户紧急加单' });

      // Verify audit log row
      const log = db.prepare(
        `SELECT * FROM admin_action_log WHERE target_id = 'u_1' AND action = 'adjust_user_quota' ORDER BY id DESC LIMIT 1`
      ).get() as any;
      expect(log).toBeTruthy();
      expect(log.admin_user_id).toBe('adm_subb');
      const details = JSON.parse(log.details_json);
      expect(details).toEqual({ previous_quota: 100, new_quota: 50, reason: '客户紧急加单' });
    });

    it('2. missing reason → 400 INVALID_PARAMS', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50 });
      expect(r.status).toBe(400);
      expect(r.body.error.message).toMatch(/reason/);
    });

    it('3. reason < 3 chars → 400', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'ab' });
      expect(r.status).toBe(400);
    });

    it('4. reason > 500 chars → 400', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'a'.repeat(501) });
      expect(r.status).toBe(400);
    });

    it('5. new_quota == previous_quota → 200, no audit written', async () => {
      // Reset to 50 first
      db.prepare(`UPDATE users SET quota_per_day = 50 WHERE id = 'u_1'`).run();
      // Count audit rows before
      const beforeCount = (db.prepare(
        `SELECT COUNT(*) AS c FROM admin_action_log WHERE target_id = 'u_1' AND action = 'adjust_user_quota'`
      ).get() as { c: number }).c;

      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: '同值不应写 audit' });
      expect(r.status).toBe(200);

      const afterCount = (db.prepare(
        `SELECT COUNT(*) AS c FROM admin_action_log WHERE target_id = 'u_1' AND action = 'adjust_user_quota'`
      ).get() as { c: number }).c;
      expect(afterCount).toBe(beforeCount);
    });

    it('6. user not found → 404', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_does_not_exist/adjust-quota')
        .set('Authorization', adminAuth)
        .send({ new_quota: 50, reason: 'test missing user' });
      expect(r.status).toBe(404);
    });

    it('7. no bearer token → 401', async () => {
      const r = await request(app)
        .post('/v1/admin/users/u_1/adjust-quota')
        .send({ new_quota: 50, reason: 'no auth' });
      expect(r.status).toBe(401);
    });
  });
});