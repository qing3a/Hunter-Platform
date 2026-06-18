import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

describe('action_history middleware integration', () => {
  const testDb = path.join(__dirname, '../../tmp/ah-mw.db');
  let app: any;
  let db: any;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());
  });

  afterAll(() => {
    if (db) db.close();
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  beforeEach(() => {
    db.exec('DELETE FROM action_history');
    db.exec('DELETE FROM rate_limit_buckets');
  });

  /** Helper: directly insert a user with a known API key (bypasses register IP rate limit) */
  function createUserDirectly(userType: 'headhunter' | 'employer' | 'candidate', apiKey: string): string {
    const userId = `user_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    db.prepare(`
      INSERT INTO users (id, user_type, name, contact, agent_endpoint,
                         api_key_hash, api_key_prefix, quota_per_day, quota_used,
                         quota_reset_at, reputation, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, userType, `Test ${userType}`, `${userType}_${Date.now()}_${randomUUID().slice(0,4)}@x.com`, null,
      bcrypt.hashSync(apiKey, 4), apiKey.slice(0, 12), 100, 0,
      tomorrow, 50, 'active', now, now,
    );
    return userId;
  }

  it('writes register entry on POST /v1/auth/register', async () => {
    const res = await request(app).post('/v1/auth/register').send({
      user_type: 'headhunter', name: 'Test', contact: `reg_${Date.now()}_${randomUUID().slice(0,4)}@x.com`,
    });
    expect(res.status).toBe(200);
    const rows = db.prepare("SELECT * FROM action_history WHERE action_type = 'register'").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).status).toBe('success');
    expect((rows[0] as any).target_type).toBe('user');
  });

  it('writes upload_candidate entry with target_id when headhunter uploads', async () => {
    const candUserId = createUserDirectly('candidate', 'hp_live_test_cand');
    const hhApiKey = 'hp_live_test_hh_upload';
    createUserDirectly('headhunter', hhApiKey);

    const up = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhApiKey}`)
      .send({
        candidate_user_id: candUserId,
        name: '张三', phone: '13800138000', email: 'z@example.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 700000, years_experience: 7,
        skills: ['React', 'TypeScript'],
      });
    expect(up.status).toBe(200);
    const anonId = up.body.data.anonymized_id;

    const rows = db.prepare("SELECT * FROM action_history WHERE action_type = 'upload_candidate'").all() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find(r => r.target_id === anonId);
    expect(row).toBeTruthy();
    expect(row.target_type).toBe('candidate');
    const summary = JSON.parse(row.response_summary_json);
    expect(summary.anonymized_id).toBe(anonId);
    expect(summary.industry).toBe('互联网');
  });

  it('does NOT write when req.user is missing (401 unauthenticated)', async () => {
    // Deviation from plan: 中间件在无 user_id 时跳过写（避免污染 action_history 为"匿名"）
    const before = (db.prepare("SELECT COUNT(*) as cnt FROM action_history").get() as any).cnt;
    await request(app).post('/v1/headhunter/candidates').send({});
    const after = (db.prepare("SELECT COUNT(*) as cnt FROM action_history").get() as any).cnt;
    expect(after).toBe(before);  // 不写
  });

  it('records duration_ms in reasonable range (>= 0)', async () => {
    const res = await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'E', contact: `emp_${Date.now()}_${randomUUID().slice(0,4)}@x.com`,
    });
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT * FROM action_history WHERE action_type='register' ORDER BY id DESC LIMIT 1").get() as any;
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
    expect(row.duration_ms).toBeLessThan(10000);
  });

  it('does NOT write when path is outside whitelist (e.g. /v1/users/:id/status)', async () => {
    const before = (db.prepare("SELECT COUNT(*) as cnt FROM action_history").get() as any).cnt;
    await request(app).get('/v1/users/user_abc/status');
    const after = (db.prepare("SELECT COUNT(*) as cnt FROM action_history").get() as any).cnt;
    expect(after).toBe(before);
  });

  it('writes express_interest entry with target_type=recommendation', async () => {
    // Setup users directly in DB (bypass IP rate limit)
    const candUserId = createUserDirectly('candidate', 'hp_live_test_cand2');
    const hhApiKey = 'hp_live_test_hh_ei';
    createUserDirectly('headhunter', hhApiKey);
    const empApiKey = 'hp_live_test_emp_ei';
    const empUserId = createUserDirectly('employer', empApiKey);

    // Upload candidate
    const up = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhApiKey}`)
      .send({
        candidate_user_id: candUserId,
        name: '李四', phone: '13900139000', email: 'l@example.com',
        current_company: '美团', current_title: 'P6',
        expected_salary: 500000, years_experience: 5,
      });
    expect(up.status).toBe(200);
    const anonId = up.body.data.anonymized_id;

    // Create job (as employer)
    const job = await request(app)
      .post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empApiKey}`)
      .send({ title: '高级前端工程师', industry: '互联网' });
    expect(job.status).toBe(200);

    // Recommend candidate to job (as headhunter)
    const rec = await request(app)
      .post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${hhApiKey}`)
      .send({ anonymized_candidate_id: anonId, job_id: job.body.data.id });
    expect(rec.status).toBe(200);
    const recId = rec.body.data.id;

    // Clear action_history to focus on this test
    db.exec('DELETE FROM action_history');

    // Action: express interest
    const exInt = await request(app)
      .post(`/v1/employer/recommendations/${recId}/express-interest`)
      .set('Authorization', `Bearer ${empApiKey}`)
      .send({});
    expect(exInt.status).toBe(200);

    const rows = db.prepare("SELECT * FROM action_history WHERE action_type = 'express_interest'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('recommendation');
    expect(rows[0].target_id).toBe(recId);
    expect(rows[0].status).toBe('success');
    // ensure no PII leaked
    expect(rows[0].user_id).toBe(empUserId);
  });
});