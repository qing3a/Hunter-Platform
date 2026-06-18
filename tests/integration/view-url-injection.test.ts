import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('view_url injection', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('POST /v1/headhunter/candidates success response includes view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const apiKey = reg.body.data.api_key;
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'c@c.com' });

    const res = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        candidate_user_id: candReg.body.data.user_id,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 750000, years_experience: 8,
        education_school: '清华大学', skills: ['React'],
      });

    expect(res.body.data.view_url).toMatch(/^https?:\/\/[^/]+\/view\/candidate\/[^?]+\?t=[a-f0-9]{64}$/);
  });

  it('GET /v1/users/{id}/status response includes view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const res = await request(app).get(`/v1/users/${reg.body.data.user_id}/status`)
      .set('Authorization', `Bearer ${reg.body.data.api_key}`);
    expect(res.body.data.view_url).toMatch(/^https?:\/\/[^/]+\/view\/user-quota\//);
  });

  it('401 error response does NOT include view_url', async () => {
    const res = await request(app).post('/v1/headhunter/candidates').send({});
    expect(res.body.data?.view_url).toBeUndefined();
  });

  it('400 validation error does NOT include view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const res = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${reg.body.data.api_key}`)
      .send({ invalid: 'body' });
    expect(res.body.data?.view_url).toBeUndefined();
  });

  it('unmapped endpoint does NOT include view_url', async () => {
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const res = await request(app).get('/v1/config/industries')
      .set('Authorization', `Bearer ${reg.body.data.api_key}`);
    expect(res.body.data?.view_url).toBeUndefined();
  });
});