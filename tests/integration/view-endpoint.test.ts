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
    userId = hhReg.body.data.id;
    apiKey = hhReg.body.data.api_key;
  });

  afterEach(() => {
    delete process.env.DATABASE_PATH;
  });

  it('GET /view/candidate/:id with valid token returns HTML', async () => {
    // Register a candidate (so we can upload their profile)
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@x.com' });
    const candId = candReg.body.data.id;

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

  it('GET /view/recommendation/:id with valid token returns timeline HTML', async () => {
    // Register candidate + upload
    const candReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'Rec Cand', contact: 'rec-c@c.com' });
    const candId = candReg.body.data.id;

    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        candidate_user_id: candId,
        name: 'X', phone: '13800138000', email: 'r@x.com',
        current_company: 'A', current_title: 'T',
        expected_salary: 100000, years_experience: 1,
        education_school: 'S', skills: [],
      });
    const anonymizedId = upload.body.data.anonymized_id;

    // Register employer + post job
    const empReg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'Test Emp', contact: 'rec-e@e.com' });
    const empKey = empReg.body.data.api_key;
    const job = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empKey}`)
      .send({ title: 'Senior Engineer', description: 'A role' });
    const jobId = job.body.data.id;

    // Headhunter recommends candidate to job
    const rec = await request(app).post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ anonymized_candidate_id: anonymizedId, job_id: jobId });
    const viewUrl = rec.body.data.view_url;
    expect(viewUrl).toMatch(/^https?:\/\/[^/]+\/view\/recommendation\//);

    const viewRes = await request(app).get(stripHost(viewUrl));
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^text\/html/);
    expect(viewRes.text).toContain('推荐状态');
    expect(viewRes.text).toContain('猎头推荐'); // first timeline step
  });

  it('GET /view/audit/:id (obtained via POST /v1/views/audit) returns audit HTML', async () => {
    // Generate some audit history by calling status
    await request(app).get(`/v1/users/${userId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    // Use the new explicit endpoint to obtain a view URL
    const tokenRes = await request(app)
      .post(`/v1/views/audit/${userId}`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(tokenRes.status).toBe(200);
    const viewUrl = tokenRes.body.data.view_url;
    expect(viewUrl).toMatch(/^https?:\/\/[^/]+\/view\/audit\//);

    const viewRes = await request(app).get(stripHost(viewUrl));
    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/^text\/html/);
    expect(viewRes.text).toContain('审计日志');
    expect(viewRes.text).toContain(userId);
  });
});

/** Strip the http(s)://host prefix from an absolute URL to get a path supertest can GET. */
function stripHost(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}