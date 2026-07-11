import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('candidate endpoints — opportunities + access_log', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('GET /v1/candidate/opportunities returns 200 for a candidate with no recommendations', async () => {
    const app = createApp();
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'OppC', contact: 'oppc@c.com' });

    const res = await request(app).get('/v1/candidate/opportunities')
      .set('Authorization', `Bearer ${cand.body.data.api_key}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /v1/candidate/opportunities returns recommendations involving this candidate', async () => {
    const app = createApp();
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'OppC2', contact: 'oppc2@c.com' });
    const candKey = cand.body.data.api_key;
    const candId = cand.body.data.id;

    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'OppHH', contact: 'opphh@h.com' });

    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: candId, name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: '字节跳动',
        current_company: 'A', current_title: 'T',
        expected_salary: 100000, years_experience: 1,
        education_school: 'S', skills: [],
      });
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'OppE', contact: 'oppe@e.com' });
    const job = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Test Job' });
    await request(app).post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({ anonymized_candidate_id: upload.body.data.anonymized_id, job_id: job.body.data.id });

    const res = await request(app).get('/v1/candidate/opportunities')
      .set('Authorization', `Bearer ${candKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /v1/candidate/access-log returns 200 for candidate', async () => {
    const app = createApp();
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'AccC', contact: 'accc@c.com' });

    const res = await request(app).get('/v1/candidate/access-log')
      .set('Authorization', `Bearer ${cand.body.data.api_key}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /v1/candidate/access-log rejects non-candidate user (403)', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'AccE', contact: 'acce@e.com' });

    const res = await request(app).get('/v1/candidate/access-log')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`);

    expect(res.status).toBe(403);
  });

  it('GET /v1/candidate/opportunities consumes quota (skill.md says 1)', async () => {
    const app = createApp();
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'QuotaC', contact: 'qc@c.com' });
    const key = cand.body.data.api_key;

    // First call: consumes 1 quota
    await request(app).get('/v1/candidate/opportunities').set('Authorization', `Bearer ${key}`);
    // Second call: also consumes (total 2)
    await request(app).get('/v1/candidate/opportunities').set('Authorization', `Bearer ${key}`);

    const status = await request(app).get(`/v1/users/${cand.body.data.id}/status`)
      .set('Authorization', `Bearer ${key}`);
    expect(status.body.data.quota_used).toBeGreaterThanOrEqual(2);
  });
});