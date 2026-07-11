import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/config/*', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  async function registerHeadhunter() {
    const app = createApp();
    const res = await request(app).post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'CfgHH', contact: 'cfg@h.com' });
    return { app, apiKey: res.body.data.api_key };
  }

  describe('GET /v1/config/industries', () => {
    it('returns 200 + array of industries with companies_count', async () => {
      const { app, apiKey } = await registerHeadhunter();
      const res = await request(app).get('/v1/config/industries')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const internet = res.body.data.find((c: any) => c.id === '互联网');
      expect(internet).toBeDefined();
      expect(internet.companies_count).toBeGreaterThan(0);
    });

    it('returns 200 without auth (optional-auth: public)', async () => {
      // /v1/config/* uses optionalAuthMiddleware — anonymous callers get the same
      // response as authenticated ones (see "已修复" #2).
      const app = createApp();
      const res = await request(app).get('/v1/config/industries');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /v1/config/title_levels', () => {
    it('returns 200 + title level patterns', async () => {
      const { app, apiKey } = await registerHeadhunter();
      const res = await request(app).get('/v1/config/title_levels')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const codes = res.body.data.map((t: any) => t.code);
      expect(codes).toContain('P6');
      expect(codes).toContain('P7+');
      expect(codes).toContain('M1');
    });

    it('returns 200 without auth (optional-auth: public)', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/config/title_levels');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /v1/config/salary_bands', () => {
    it('returns 200 + salary bands', async () => {
      const { app, apiKey } = await registerHeadhunter();
      const res = await request(app).get('/v1/config/salary_bands')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      const first = res.body.data[0];
      expect(first.label).toBeDefined();
      expect(typeof first.min).toBe('number');
      expect(first.max === null || typeof first.max === 'number').toBe(true);
    });

    it('returns 200 without auth (optional-auth: public)', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/config/salary_bands');
      expect(res.status).toBe(200);
    });
  });
});
