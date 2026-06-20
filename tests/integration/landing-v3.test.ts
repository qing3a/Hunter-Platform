// tests/integration/landing-v3.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / - v3 features', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('renders sticky top nav', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="top-nav"');
    expect(res.text).toContain('Hunter Platform');
  });

  it('renders status badge with HEALTHY label', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('HEALTHY');
    expect(res.text).toContain('99.9');
  });

  it('renders 4 role anchors', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('for-employers');
    expect(res.text).toContain('for-headhunters');
    expect(res.text).toContain('for-candidates');
    expect(res.text).toContain('rankings');
  });

  it('renders AGENT GATE with copy button', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="agent-gate"');
    expect(res.text).toContain('/v1/skill.md');
    expect(res.text).toContain('js-copy-btn');
  });

  it('renders 5 ranking tabs', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('Top 猎头');
    expect(res.text).toContain('Top 雇主');
    expect(res.text).toContain('Top 行业');
    expect(res.text).toContain('成交');
    expect(res.text).toContain('Hot Skills');
  });

  it('renders footer with skill.md + openapi + health links', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="site-footer"');
    expect(res.text).toContain('Made with care for Agents');
  });

  it('does not leak PII (emails, user IDs)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'leak@private.com',
    });
    const res = await request(app).get('/');
    expect(res.text).not.toContain('leak@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
  });

  it('handles empty DB gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hunter Platform');
  });
});