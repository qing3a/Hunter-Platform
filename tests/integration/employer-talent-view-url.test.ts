import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/talent-view-url.db');
let app: any;

describe('GET /v1/employer/talent — view_url injection (Bug #11)', () => {
  let hhKey: string;
  let empKey: string;
  let candId: string;
  let publishedAnonId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // Setup: headhunter, candidate, employer
    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    hhKey = hh.body.data.api_key;
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candId = cand.body.data.id;
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    empKey = emp.body.data.api_key;
  });

  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  beforeEach(async () => {
    // Upload a candidate and publish to the public pool.
    // Each test runs with a fresh published candidate so candidates don't accumulate.
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhKey}`)
      .send({
        candidate_user_id: candId,
        name: '测试', phone: '13800138000', email: 't@x.com',
        current_company: '字节跳动', current_title: 'P6 高级',
        expected_salary: 600000, years_experience: 8,
        education_school: '清华大学', skills: ['React'],
      });
    publishedAnonId = upload.body.data.anonymized_id;
    await request(app).post(`/v1/headhunter/candidates/${publishedAnonId}/publish-to-pool`)
      .set('Authorization', `Bearer ${hhKey}`);
  });

  it('each AnonymizedCandidate element includes view_url', async () => {
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const c of res.body.data) {
      expect(c.view_url).toBeDefined();
      expect(typeof c.view_url).toBe('string');
      expect(c.view_url).toMatch(/^http:\/\/localhost:3000\/view\//);
    }
  });

  it('view_url contains the candidate anonymized_id', async () => {
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    const c = res.body.data.find((x: any) => x.anonymized_id === publishedAnonId);
    expect(c).toBeDefined();
    expect(c.view_url).toContain(encodeURIComponent(publishedAnonId));
  });

  it('view_url is single-use (second access returns 410)', async () => {
    const res = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    const c = res.body.data[0];
    const first = await request(app).get(c.view_url.replace('http://localhost:3000', ''));
    expect([200, 410]).toContain(first.status); // 200 first time, 410 after
    const second = await request(app).get(c.view_url.replace('http://localhost:3000', ''));
    expect(second.status).toBe(410);
  });
});