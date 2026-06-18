import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('view token atomicity', () => {
  let app: ReturnType<typeof createApp>;
  let viewUrl: string;

  beforeEach(async () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();

    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@h.com' });
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'c@c.com' });
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.user_id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: 'A', current_title: 'T',
        expected_salary: 100000, years_experience: 1,
        education_school: 'S', skills: [],
      });
    viewUrl = upload.body.data.view_url.replace(/^https?:\/\/[^/]+/, '');
  });

  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('two concurrent requests with same token: exactly one succeeds', async () => {
    const [r1, r2] = await Promise.all([
      request(app).get(viewUrl),
      request(app).get(viewUrl),
    ]);
    const successes = [r1.status, r2.status].filter((s) => s === 200).length;
    expect(successes).toBe(1);
  });

  it('sequential requests with same token: first 200, second 410', async () => {
    const r1 = await request(app).get(viewUrl);
    expect(r1.status).toBe(200);
    const r2 = await request(app).get(viewUrl);
    expect(r2.status).toBe(410);
  });
});