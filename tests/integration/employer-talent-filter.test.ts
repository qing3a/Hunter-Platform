import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/talent-filter.db');
let app: any;

describe('GET /v1/employer/talent — salary filter', () => {
  let hhKey: string;
  let empKey: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // 注册 headhunter 并上传 4 个不同 salary 的候选人（覆盖 4 个不同 band：0-20万 / 40-60万 / 120-200万 / 200万+）
    const hhRes = await request(app).post('/v1/auth/register')
      .send({ user_type: 'hr', name: 'Filter-HH', contact: 'fh@x.com' });
    hhKey = hhRes.body.data.api_key;
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'fc@x.com' });
    const candId = cand.body.data.id;

    // 上传 4 个：salary 触发 4 个不同 band（T-E 需要 200万+ band 候选人）
    for (const [company, salary, title] of [
      ['字节跳动', 100000, 'P5 初级'],
      ['阿里巴巴', 500000, 'P6 高级'],
      ['腾讯',   1500000, 'P7+ 资深'],
      ['百度',   2500000, 'P9 首席专家'],
    ]) {
      await request(app).post('/v1/headhunter/candidates')
        .set('Authorization', `Bearer ${hhKey}`)
        .send({
          candidate_user_id: candId,
          name: 'x', phone: '1', email: 'a@b.com',
          current_company: company, current_title: title,
          expected_salary: salary, years_experience: 5,
          education_school: '清华大学', skills: ['React']
        });
    }

    // 公开到池子
    const list = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhKey}`);
    for (const c of list.body.data) {
      await request(app).post(`/v1/headhunter/candidates/${c.anonymized_id}/publish-to-pool`)
        .set('Authorization', `Bearer ${hhKey}`);
    }

    // 注册 employer
    const empRes = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'Filter-Emp', contact: 'fe@x.com' });
    empKey = empRes.body.data.api_key;
  });

  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('T-A: 无 salary filter 返回所有 4 个候选人', async () => {
    const r = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(4);
  });

  it('T-B: min_salary=400000 排除 < 40 万', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=400000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      // 命中的 band min ≥ 400000: 40-60万, 60-80万, 80-120万, 120-200万, 200万+
      expect(['40-60万', '60-80万', '80-120万', '120-200万', '200万+']).toContain(c.salary_range);
    }
  });

  it('T-C: max_salary=600000 排除 > 60 万', async () => {
    const r = await request(app).get('/v1/employer/talent?max_salary=600000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      // 命中的 band max ≤ 600000: 0-20万, 20-40万, 40-60万
      expect(['0-20万', '20-40万', '40-60万']).toContain(c.salary_range);
    }
  });

  it('T-D: min_salary=400000 + max_salary=800000 取交集', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=400000&max_salary=800000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      // 命中: 40-60万, 60-80万
      expect(['40-60万', '60-80万']).toContain(c.salary_range);
    }
  });

  it('T-E: min_salary=2000000 包含 200万+', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=2000000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    // 应包含 200万+ band 的候选人
    expect(r.body.data.some((c: any) => c.salary_range === '200万+')).toBe(true);
  });

  it('T-F: 与 industry 组合 AND', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=400000&industry=互联网')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      expect(c.industry).toBe('互联网');
      expect(['40-60万', '60-80万', '80-120万', '120-200万', '200万+']).toContain(c.salary_range);
    }
  });

  it('T-G: min > max 返回空数组（不报错）', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=2000000&max_salary=100000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('T-H: 无效值（NaN）被忽略', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=invalid')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    // 应返回所有候选人（filter 被忽略）
    expect(r.body.data.length).toBeGreaterThanOrEqual(4);
  });
});