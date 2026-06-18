import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('view endpoints — happy path', () => {
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

    // Register a headhunter (will be the authenticated user for viewable actions)
    const hhReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Test HH', contact: 'h@x.com' });
    userId = hhReg.body.data.user_id;
    apiKey = hhReg.body.data.api_key;
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
  });

  it('GET /view/candidate/:id with valid token returns HTML', async () => {
    // Register a candidate (so we can upload their profile)
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    const candId = candReg.body.data.user_id;

    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        candidate_user_id: candId,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 750000, years_experience: 8,
        education_school: '清华大学', skills: ['React', 'TypeScript'],
      });

    const viewUrl = upload.body.data.view_url;
    expect(viewUrl).toMatch(/^https?:\/\/[^/]+\/view\/candidate\//);

    const viewRes = await request(app).get(stripHost(viewUrl));
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^text\/html/);
    expect(viewRes.text).toContain('候选人画像');
    expect(viewRes.text).toContain('互联网'); // industry after desensitize
    expect(viewRes.text).not.toContain('张三'); // PII removed
  });

  it('GET /view/users/:id/status with valid token returns quota HTML', async () => {
    const statusRes = await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);
    const viewUrl = statusRes.body.data.view_url;
    expect(viewUrl).toMatch(/^https?:\/\/[^/]+\/view\/user-quota\//);

    const viewRes = await request(app).get(stripHost(viewUrl));
    expect(viewRes.status).toBe(200);
    expect(viewRes.text).toContain('用户配额');
    expect(viewRes.text).toContain(userId);
  });
});

/** Strip the http(s)://host prefix from an absolute URL to get a path supertest can GET. */
function stripHost(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}