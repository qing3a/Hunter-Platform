// tests/integration/landing-v4.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / - v4 enrichment (3 new modules)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('renders job category nav section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card job-category-nav"');
    expect(res.text).toContain('职位分类');
  });

  it('renders featured jobs section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card featured-jobs"');
    expect(res.text).toContain('精选/热招职位');
  });

  it('renders hot companies section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="card hot-companies"');
    expect(res.text).toContain('热门企业');
  });

  it('3 new modules appear between hero and stats (order check)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    const html = res.text;
    const heroIdx = html.indexOf('class="hero"');
    const catNavIdx = html.indexOf('class="card job-category-nav"');
    const featIdx = html.indexOf('class="card featured-jobs"');
    const hotIdx = html.indexOf('class="card hot-companies"');
    const statsIdx = html.indexOf('class="card hero-stats"');
    expect(heroIdx).toBeGreaterThan(0);
    expect(catNavIdx).toBeGreaterThan(heroIdx);
    expect(featIdx).toBeGreaterThan(catNavIdx);
    expect(hotIdx).toBeGreaterThan(featIdx);
    expect(statsIdx).toBeGreaterThan(hotIdx);
  });

  it('renders empty-state copy when DB has no data', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('暂无分类数据');
    expect(res.text).toContain('暂无开放岗位。Agent 可调');
    expect(res.text).toContain('暂无热门企业');
  });

  it('does not leak PII (user_id, contact, email, phone)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).not.toMatch(/contact@|email.*@|phone.*\d{11}/i);
    // industry names / company names are OK to show
  });

  it('render time < 300ms (v3 baseline 200ms + 100ms budget)', async () => {
    const app = createApp();
    const start = Date.now();
    await request(app).get('/');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(300);
  });

  it('v3 features still render (regression)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="top-nav"');
    expect(res.text).toContain('HEALTHY');
    expect(res.text).toContain('Top 猎头');
    expect(res.text).toContain('for-employers');
  });
});