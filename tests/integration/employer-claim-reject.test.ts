// tests/integration/employer-claim-reject.test.ts
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

describe('GET /v1/employer/pending-claims', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('返回 created_for_employer_id=me 的待认领 job', async () => {
    const app = createApp();
    const emp1 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const emp2 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E2', contact: 'e2@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;

    // hh 给 emp1 建一个，给 emp2 建一个，没指定的建一个
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp1.id });
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J2', created_for_employer_id: emp2.id });
    await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J3' });

    const res = await request(app).get('/v1/employer/pending-claims').set('Authorization', `Bearer ${emp1.api_key}`);
    expect(res.status).toBe(200);
    // emp1 看到 J1 (显式指定) + J3 (无指定, 任何 employer 可 claim)
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((j: any) => j.title).sort()).toEqual(['J1', 'J3']);
  });
});

describe('POST /v1/employer/claim-jobs/:id', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('雇主认领属于自己的待领 → 200, employer_id 填上', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    const res = await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.employer_id).toBe(emp.id);
    expect(res.body.data.source_headhunter_id).toBe(hh.id);
  });

  it('雇主认领不属于自己 (created_for_employer_id=其他 employer) → 403', async () => {
    const app = createApp();
    const emp1 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const emp2 = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E2', contact: 'e2@e.com' })).body.data;
    const hh   = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job  = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp1.id })).body.data;

    const res = await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp2.api_key}`);
    expect(res.status).toBe(403);
  });

  it('同一 employer 重复 claim 自己的 job → 200 idempotent', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    const res = await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/employer/reject-jobs/:id', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('雇主拒绝 → status=closed', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    const res = await request(app).post(`/v1/employer/reject-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`).send({ reason: 'not my job' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
  });

  it('拒绝后 GET /pending-claims 不再返回', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hh  = (await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' })).body.data;
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hh.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;

    await request(app).post(`/v1/employer/reject-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`).send({});
    const res = await request(app).get('/v1/employer/pending-claims').set('Authorization', `Bearer ${emp.api_key}`);
    expect(res.body.data).toHaveLength(0);
  });
});
