// tests/integration/headhunter-create-job.test.ts
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

describe('POST /v1/headhunter/jobs', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  async function registerEmployer() {
    const res = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E1', contact: 'e@e.com' });
    return res.body.data;
  }
  async function registerHeadhunter() {
    const res = await request(createApp()).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H1', contact: 'h@h.com' });
    return res.body.data;
  }

  it('headhunter 创建成功 + employer_id=NULL + source_headhunter_id=me', async () => {
    const emp = await registerEmployer();
    const hh = await registerHeadhunter();
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh.api_key}`)
      .send({ title: 'T1', industry: '互联网', created_for_employer_id: emp.id });
    expect(res.status).toBe(200);
    expect(res.body.data.employer_id).toBeNull();
    expect(res.body.data.source_headhunter_id).toBe(hh.id);
    expect(res.body.data.created_for_employer_id).toBe(emp.id);
    expect(res.body.data.status).toBe('open');
  });

  it('不指定 created_for_employer_id 也允许 (任何 employer 可 claim)', async () => {
    const hh = await registerHeadhunter();
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh.api_key}`)
      .send({ title: 'T2' });
    expect(res.status).toBe(200);
    expect(res.body.data.created_for_employer_id).toBeNull();
  });

  it('employer 调 POST /v1/headhunter/jobs → 403', async () => {
    const emp = await registerEmployer();
    const res = await request(createApp())
      .post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${emp.api_key}`)
      .send({ title: 'T3' });
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/headhunter/jobs (my created)', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('只返回 source_headhunter_id=me 的 job', async () => {
    const app = createApp();
    const emp1 = (await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh1 = (await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const hh2 = (await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'H2', contact: 'h2@h.com' })).body.data;

    // hh1 建 2 个, hh2 建 1 个
    await request(app).post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh1.api_key}`)
      .send({ title: 'H1A', created_for_employer_id: emp1.id });
    await request(app).post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh1.api_key}`)
      .send({ title: 'H1B' });
    await request(app).post('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh2.api_key}`)
      .send({ title: 'H2A' });

    const res = await request(app)
      .get('/v1/headhunter/jobs')
      .set('Authorization', `Bearer ${hh1.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((j: any) => j.source_headhunter_id === hh1.id)).toBe(true);
  });
});
