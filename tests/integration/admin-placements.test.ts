import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/placements (Sub-D3 Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd3-placements-test.db');
  let app: any, db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subd3_p_aa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd3_p', 'SubD3 Admin', 'subd3p@test.com', pwdHash, keyHash, 'hp_admin_subd3_p', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'subd3p@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed users (FK requirement for placements)
    for (const [id, userType] of [
      ['emp_1', 'employer'],
      ['u_1', 'candidate'],
      ['u_2', 'candidate'],
      ['u_3', 'candidate'],
      ['u_4', 'candidate'],
      ['hh_1', 'headhunter'],
    ] as const) {
      db.prepare(`INSERT OR IGNORE INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, ?, ?, 't@x', ?, 'hp', 100, 0, datetime('now','+1 day'), 50, 'active',
        '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run(id, userType, `User ${id}`, `h_${id}`);
    }
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_1', 'emp_1', 'Senior Eng', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_2', 'emp_1', 'PM', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_3', 'emp_1', 'Eng3', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();
    db.prepare(`INSERT INTO jobs (id, employer_id, title, status, created_at, updated_at)
      VALUES ('job_4', 'emp_1', 'Eng4', 'open', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run();

    // Seed candidates_anonymized (FK for placements)
    db.prepare(`INSERT INTO candidates_private (id, candidate_user_id, name_enc, phone_enc, email_enc,
      current_company_raw, current_title_raw, expected_salary, years_experience, education_school,
      headhunter_id, created_at, updated_at) VALUES (?, ?, 'x', 'x', 'x', 'X', 'T', 100000, 1, 'S', 'hh_1', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run('cp_d3_1', 'u_1');
    db.prepare(`INSERT INTO candidates_private (id, candidate_user_id, name_enc, phone_enc, email_enc,
      current_company_raw, current_title_raw, expected_salary, years_experience, education_school,
      headhunter_id, created_at, updated_at) VALUES (?, ?, 'x', 'x', 'x', 'X', 'T', 100000, 1, 'S', 'hh_1', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run('cp_d3_2', 'u_2');
    db.prepare(`INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, is_public_pool, unlock_status, created_at, updated_at)
      VALUES (?, ?, 'hh_1', 1, 'locked', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run('c_d3_1', 'cp_d3_1');
    db.prepare(`INSERT INTO candidates_anonymized (id, source_private_id, source_headhunter_id, is_public_pool, unlock_status, created_at, updated_at)
      VALUES (?, ?, 'hh_1', 1, 'locked', '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run('c_d3_2', 'cp_d3_2');

    // 4 placements: 2 pending, 1 paid, 1 cancelled (different job_id to satisfy UNIQUE constraint)
    for (const [id, status, candId, jobId] of [
      ['p_1', 'pending_payment', 'c_d3_1', 'job_1'],
      ['p_2', 'pending_payment', 'c_d3_2', 'job_2'],
      ['p_3', 'paid', 'c_d3_1', 'job_3'],
      ['p_4', 'cancelled', 'c_d3_2', 'job_4'],
    ] as const) {
      db.prepare(`INSERT INTO placements (id, job_id, anonymized_candidate_id, candidate_user_id,
        primary_headhunter_id, referrer_headhunter_id, annual_salary, platform_fee, primary_share, referrer_share,
        candidate_bonus, status, created_at, updated_at)
        VALUES (?, ?, ?, 'u_1', 'hh_1', NULL, 500000, 50000, 40000, 10000, 0, ?, '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run(
        id, jobId, candId, status
      );
    }
  });

  afterAll(() => { if (db) db.close(); });

  it('1. default returns all 4 placements', async () => {
    const r = await request(app).get('/v1/admin/placements').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(4);
    expect(r.body.data).toHaveLength(4);
  });

  it('2. status=paid filter returns only paid', async () => {
    const r = await request(app).get('/v1/admin/placements?status=paid').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.data.every((row: any) => row.status === 'paid')).toBe(true);
  });

  it('3. status=invalid → 400', async () => {
    const r = await request(app).get('/v1/admin/placements?status=garbage').set('Authorization', adminAuth);
    expect(r.status).toBe(400);
  });

  it('4. from/until time range', async () => {
    const fromTs = '2026-06-24T00:00:00Z';
    const r = await request(app).get(`/v1/admin/placements?from=${encodeURIComponent(fromTs)}`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(4);
  });

  it('5. POST /placements/:id/mark-paid → status=paid', async () => {
    const r = await request(app).post('/v1/admin/placements/p_1/mark-paid').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: 'p_1', status: 'paid' });
  });

  it('6. POST /placements/:id/cancel → status=cancelled (with audit log)', async () => {
    const r = await request(app).post('/v1/admin/placements/p_2/cancel').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: 'p_2', status: 'cancelled' });
    // Verify audit log written
    const log = db.prepare(`SELECT * FROM admin_action_log WHERE target_id = 'p_2' AND action = 'cancel_placement'`).get() as any;
    expect(log).toBeTruthy();
  });

  it('7. cancel paid → 409 invalid_state', async () => {
    const r = await request(app).post('/v1/admin/placements/p_3/cancel').set('Authorization', adminAuth);
    expect(r.status).toBe(409);
  });
});