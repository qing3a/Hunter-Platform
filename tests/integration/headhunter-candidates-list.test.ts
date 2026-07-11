import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/headhunter/candidates', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns the headhunter\'s uploaded candidates with anonymized_id', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'MyCandHH', contact: 'mycand@h.com' });
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@c.com' });

    await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: '字节跳动', current_title: 'P6',
        expected_salary: 600000, years_experience: 5,
        education_school: 'S', skills: [],
      });

    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].anonymized_id).toMatch(/^ca_/);
    expect(res.body.data[0].industry).toBe('互联网');
    expect(res.body.data[0].id).toBeUndefined(); // Convention A: only anonymized_id
  });

  it('returns empty array for headhunter with no uploads', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'EmptyHH', contact: 'empty@h.com' });

    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 403 when called by an employer (not headhunter)', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'EmpE', contact: 'e@e.com' });
    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/headhunter/candidates');
    expect(res.status).toBe(401);
  });
});
