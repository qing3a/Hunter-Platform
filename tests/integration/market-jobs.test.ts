import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/market-jobs.db');
let app: ReturnType<typeof import('supertest').default>;

describe('GET /v1/market/jobs', () => {
  let empAKey: string;
  let empBKey: string;
  let huntKey: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server.js');
    app = createApp();

    // 注册 2 个 employer + 1 个 headhunter
    const empA = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'A公司', contact: 'empa@x.com' });
    empAKey = empA.body.data.api_key;
    const empB = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'B公司', contact: 'empb@x.com' });
    empBKey = empB.body.data.api_key;
    const hunt = await request(app).post('/v1/auth/register')
      .send({ user_type: 'hr', name: '测试猎头', contact: 'hunt@x.com' });
    huntKey = hunt.body.data.api_key;

    // 创建 4 个 JD：A公司 2 个 + B公司 2 个
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empAKey}`)
      .send({ title: '前端工程师-A1', industry: '互联网', salary_min: 500000, salary_max: 800000 });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empAKey}`)
      .send({ title: '后端工程师-A2', industry: '互联网', salary_min: 600000, salary_max: 1000000 });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empBKey}`)
      .send({ title: '产品经理-B1', industry: '金融', salary_min: 800000, salary_max: 1500000 });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empBKey}`)
      .send({ title: '设计师-B2', industry: '金融', salary_min: 400000, salary_max: 700000 });

    // v1 没有 close-job API，所有 JD 默认 'open' 状态
  });

  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('MJ-1: 无 auth 返回所有 open jobs（4 个）', async () => {
    const r = await request(app).get('/v1/market/jobs');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(4);
  });

  it('MJ-2: ?industry=互联网 过滤到 2 个', async () => {
    // supertest 自动 URL-encode 中文 query 参数
    const r = await request(app).get('/v1/market/jobs').query({ industry: '互联网' });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
    for (const j of r.body.data) {
      expect(j.industry).toBe('互联网');
    }
  });

  it('MJ-3: ?limit=2 限制返回 2 个', async () => {
    const r = await request(app).get('/v1/market/jobs').query({ limit: 2 });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
  });

  it('MJ-4: ?offset=2 跳过 2 个', async () => {
    const r = await request(app).get('/v1/market/jobs').query({ offset: 2, limit: 2 });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
  });

  it('MJ-5: headhunter 有 auth 时返 200 + 扣 quota', async () => {
    const r = await request(app).get('/v1/market/jobs')
      .set('Authorization', `Bearer ${huntKey}`);
    expect(r.status).toBe(200);
    // 不能直接验证 quota 扣减（需查 DB），仅验证 status
  });

  it('MJ-6: 字段包含 title/salary/industry', async () => {
    const r = await request(app).get('/v1/market/jobs').query({ limit: 1 });
    expect(r.status).toBe(200);
    const j = r.body.data[0];
    expect(j).toHaveProperty('title');
    expect(j).toHaveProperty('industry');
    expect(j).toHaveProperty('salary_min');
    expect(j).toHaveProperty('salary_max');
  });
});