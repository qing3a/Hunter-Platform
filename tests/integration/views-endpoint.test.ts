import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('POST /v1/views/audit/:id', () => {
  let app: ReturnType<typeof createApp>;
  let userId: string;
  let apiKey: string;

  beforeEach(async () => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    app = createApp();

    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Audit Test HH', contact: 'audit@h.com' });
    userId = reg.body.data.id;
    apiKey = reg.body.data.api_key;
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
  });

  it('returns view_url for own user_id with valid Bearer', async () => {
    const res = await request(app)
      .post(`/v1/views/audit/${userId}`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.view_url).toMatch(
      new RegExp(`^http://localhost:3000/view/audit/${userId}\\?t=[a-f0-9]{64}$`)
    );
  });

  it('the returned view_url can be fetched and renders audit HTML', async () => {
    // First generate some audit history by calling status
    await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    const res = await request(app)
      .post(`/v1/views/audit/${userId}`)
      .set('Authorization', `Bearer ${apiKey}`);
    const viewUrl: string = res.body.data.view_url;
    const path = viewUrl.replace('http://localhost:3000', '');

    const viewRes = await request(app).get(path);
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^text\/html/);
    expect(viewRes.text).toContain('审计日志');
    expect(viewRes.text).toContain(userId);
  });

  it('rejects when requesting another user\'s audit (403)', async () => {
    // Register another user
    const other = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'Other', contact: 'other@c.com' });

    // Use HH's api_key to request OTHER's audit
    const res = await request(app)
      .post(`/v1/views/audit/${other.body.data.id}`)
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.status).toBe(403);
  });

  it('rejects without Authorization header (401)', async () => {
    const res = await request(app).post(`/v1/views/audit/${userId}`);
    expect(res.status).toBe(401);
  });

  it('rejects with invalid Bearer token (401)', async () => {
    const res = await request(app)
      .post(`/v1/views/audit/${userId}`)
      .set('Authorization', 'Bearer hp_live_invalid');
    expect(res.status).toBe(401);
  });

  it('the returned view_url is multi-use within 7d TTL (repeated fetches all 200)', async () => {
    const res = await request(app)
      .post(`/v1/views/audit/${userId}`)
      .set('Authorization', `Bearer ${apiKey}`);
    const path = res.body.data.view_url.replace('http://localhost:3000', '');

    const first = await request(app).get(path);
    const second = await request(app).get(path);
    const third = await request(app).get(path);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
  });
});