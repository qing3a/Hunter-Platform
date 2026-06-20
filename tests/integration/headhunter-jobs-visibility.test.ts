// tests/integration/headhunter-jobs-visibility.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

function setupEnv() {
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = ':memory:';
}

describe('未认领的 job 在公开页隐藏', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('landing page 不显示 employer_id=NULL 的 job', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;

    // employer 直发 1 个
    await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${emp.api_key}`).send({ title: 'DirectJob' });
    // 猎头代发 1 个
    const hhJob = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'UnclaimedJob', created_for_employer_id: emp.id })).body.data;

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('DirectJob');
    expect(res.text).not.toContain('UnclaimedJob');

    // 认领后应该出现
    await request(app).post(`/v1/employer/claim-jobs/${hhJob.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    const res2 = await request(app).get('/');
    expect(res2.text).toContain('UnclaimedJob');
  });

  it('GET /v1/market/jobs 不返回未认领的', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;

    await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${emp.api_key}`).send({ title: 'DirectJob' });
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'UnclaimedJob', created_for_employer_id: emp.id });

    const res = await request(app).get('/v1/market/jobs');
    expect(res.status).toBe(200);
    const titles = res.body.data.map((j: any) => j.title);
    expect(titles).toContain('DirectJob');
    expect(titles).not.toContain('UnclaimedJob');
  });
});
