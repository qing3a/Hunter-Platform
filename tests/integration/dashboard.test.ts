import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /dashboard', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 + HTML with all 4 sections', async () => {
    const app = createApp();
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('Operations Dashboard');
    expect(res.text).toContain('Users &amp; Candidates');
    expect(res.text).toContain('Recommendation Pipeline');
    expect(res.text).toContain('API Calls Today');
    expect(res.text).toContain('Recent Activity');
  });

  it('reflects actual user counts after registrations', async () => {
    const app = createApp();
    // Register 2 candidates, 1 headhunter
    await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' });
    await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C2', contact: 'c2@c.com' });
    await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' });

    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    // Should show 3 total users with 2 candidates + 1 headhunter
    expect(res.text).toMatch(/Total users[\s\S]{0,200}<dd>3<\/dd>/);
  });

  it('does NOT include any PII (no user_id, contact, email)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'secret@private.com',
    });

    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('secret@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);  // no user IDs leaked
    expect(res.text).not.toContain('PII Test');  // names also not leaked (privacy choice)
  });

  it('is accessible WITHOUT auth (public endpoint)', async () => {
    const app = createApp();
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);  // not 401
  });

  it('survives empty DB (shows zeros, not errors)', async () => {
    const app = createApp();
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<dd>0</dd>');  // at least one zero count visible
    expect(res.text).toContain('No calls today yet');  // empty state for endpoints
  });
});