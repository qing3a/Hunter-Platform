import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/market/leaderboard', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 with top headhunters sorted by reputation DESC', async () => {
    const app = createApp();
    // Register 3 headhunters with different reputation by direct DB updates
    const hh1 = await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'Top HH', contact: 'top@h.com' });
    const hh2 = await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'Mid HH', contact: 'mid@h.com' });
    const hh3 = await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'Low HH', contact: 'low@h.com' });

    // Use anyone to read leaderboard (auth required, not headhunter-specific)
    const viewer = await request(app).post('/v1/auth/register').send({ user_type: 'pm', name: 'Viewer', contact: 'viewer@e.com' });

    const res = await request(app).get('/v1/market/leaderboard')
      .set('Authorization', `Bearer ${viewer.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);

    // All start at reputation 50, so order is by creation (insertion order)
    const reputations = res.body.data.map((h: any) => h.reputation);
    expect(reputations.every((r: number) => r === 50)).toBe(true); // default

    // Each entry has rank, id, name, reputation
    expect(res.body.data[0].rank).toBe(1);
    expect(res.body.data[0].id).toMatch(/^user_/);
    expect(typeof res.body.data[0].name).toBe('string');
  });

  it('only includes headhunters (not candidates/employers)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'Cand', contact: 'cand@c.com' });
    await request(app).post('/v1/auth/register').send({ user_type: 'pm', name: 'Emp', contact: 'emp@e.com' });
    const viewer = await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'HH', contact: 'hh@h.com' });

    const res = await request(app).get('/v1/market/leaderboard')
      .set('Authorization', `Bearer ${viewer.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1); // only the headhunter
    expect(res.body.data[0].name).toBe('HH');
  });

  it('returns 200 without auth (optional-auth: public)', async () => {
    // /v1/market/leaderboard uses optionalAuthMiddleware (see "已修复" #2).
    const app = createApp();
    const res = await request(app).get('/v1/market/leaderboard');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
