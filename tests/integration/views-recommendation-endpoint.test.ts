import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('POST /v1/views/recommendation/:id', () => {
  let app: ReturnType<typeof createApp>;
  let hhKey: string;
  let empKey: string;
  let candKey: string;
  let recommendationId: string;

  beforeEach(async () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();

    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'RecHH', contact: 'rechh@rec.com' });
    hhKey = hh.body.data.api_key;

    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'RecC', contact: 'recc@rec.com' });
    candKey = cand.body.data.api_key;

    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhKey}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: 'A', current_title: 'T',
        expected_salary: 100000, years_experience: 1,
        education_school: 'S', skills: [],
      });

    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'RecE', contact: 'rece@rec.com' });
    empKey = emp.body.data.api_key;

    const job = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empKey}`)
      .send({ title: 'Senior Engineer', description: 'A role' });

    const rec = await request(app).post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${hhKey}`)
      .send({ anonymized_candidate_id: upload.body.data.anonymized_id, job_id: job.body.data.id });
    recommendationId = rec.body.data.id;
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('headhunter who created the recommendation can request view URL', async () => {
    const res = await request(app).post(`/v1/views/recommendation/${recommendationId}`)
      .set('Authorization', `Bearer ${hhKey}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.view_url).toMatch(
      new RegExp(`^http://localhost:3000/view/recommendation/${recommendationId}\\?t=[a-f0-9]{64}$`)
    );
  });

  it('employer involved in the recommendation can also request view URL', async () => {
    const res = await request(app).post(`/v1/views/recommendation/${recommendationId}`)
      .set('Authorization', `Bearer ${empKey}`);
    expect(res.status).toBe(200);
    expect(res.body.data.view_url).toMatch(/^http:\/\/localhost:3000\/view\/recommendation\//);
  });

  it('rejects an unrelated user (403)', async () => {
    const other = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Other', contact: 'other@rec.com' });
    const res = await request(app).post(`/v1/views/recommendation/${recommendationId}`)
      .set('Authorization', `Bearer ${other.body.data.api_key}`);
    expect(res.status).toBe(403);
  });

  it('rejects without auth (401)', async () => {
    const res = await request(app).post(`/v1/views/recommendation/${recommendationId}`);
    expect(res.status).toBe(401);
  });

  it('returned view_url renders recommendation HTML', async () => {
    const res = await request(app).post(`/v1/views/recommendation/${recommendationId}`)
      .set('Authorization', `Bearer ${hhKey}`);
    const path = res.body.data.view_url.replace('http://localhost:3000', '');
    const viewRes = await request(app).get(path);
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^text\/html/);
    expect(viewRes.text).toContain('推荐状态');
  });

  it('view_url is multi-use within 7d TTL', async () => {
    const res = await request(app).post(`/v1/views/recommendation/${recommendationId}`)
      .set('Authorization', `Bearer ${hhKey}`);
    const path = res.body.data.view_url.replace('http://localhost:3000', '');
    const r1 = await request(app).get(path);
    const r2 = await request(app).get(path);
    const r3 = await request(app).get(path);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });
});