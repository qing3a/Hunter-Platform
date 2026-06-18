import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / (marketplace landing)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 + HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
  });

  it('contains hero + 3 role sections', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('Hunter Platform');
    expect(res.text).toContain('For Employers');
    expect(res.text).toContain('For Headhunters');
    expect(res.text).toContain('For Candidates');
  });

  it('shows real open job count', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Job 1' });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Job 2' });

    const res = await request(app).get('/');
    expect(res.text).toMatch(/在招岗位[\s\S]{0,100}2/);
  });

  it('shows candidate data after upload + publish', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' });
    const cand = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' });
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: '字节跳动', current_title: 'P6',
        expected_salary: 600000, years_experience: 5,
        education_school: 'S', skills: ['React'],
      });
    await request(app).post(`/v1/headhunter/candidates/${upload.body.data.anonymized_id}/publish-to-pool`)
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);

    const res = await request(app).get('/');
    expect(res.text).toContain('互联网');
  });

  it('does NOT include any PII', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'leaked@private.com',
    });
    const res = await request(app).get('/');
    expect(res.text).not.toContain('leaked@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
  });

  it('handles empty DB gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hunter Platform');
  });

  it('is accessible WITHOUT auth', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });
});