// tests/integration/commission-headhunter-created.test.ts
// E2E 测试 commission 70/30 split (spec §5.4 角色映射表)
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

describe('commission 70/30 split - headhunter created job', () => {
  beforeEach(setupEnv);
  afterEach(() => { delete process.env.DATABASE_PATH; });

  // 完整流程: 猎头 A 建岗 → 雇主 E 认领 → 猎头 B 推荐候选人 → 候选人授权 → 雇主 unlock → 雇主建 placement
  // 期望: primary_headhunter_id=B (70%), referrer_headhunter_id=A (30%, 因为是 job creator)

  it('跨人 (A 建, B 推荐): 70% B / 30% A', async () => {
    const app = createApp();
    // 注册
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'pm', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hhA = (await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'HA', contact: 'ha@h.com' })).body.data;
    const hhB = (await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'HB', contact: 'hb@h.com' })).body.data;
    const cand = (await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' })).body.data;

    // A 建岗, 指定 E
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hhA.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;
    // E 认领
    await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    // B 上传候选人
    const candRes = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${hhB.api_key}`).send({
      candidate_user_id: cand.id, name: 'X', phone: '13800138000', email: 'x@x.com',
      current_company: '字节跳动',
      current_company: '字节跳动', current_title: 'P6',
      expected_salary: 600000, years_experience: 5, education_school: 'S', skills: ['React'],
    });
    const anondId = candRes.body.data.anonymized_id;
    // B 推荐候选人
    await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${hhB.api_key}`).send({ anonymized_candidate_id: anondId, job_id: job.id });
    // 找到 rec
    const recList = await request(app).get('/v1/candidate/opportunities').set('Authorization', `Bearer ${cand.api_key}`);
    const rec = recList.body.data[0];
    // E 表达兴趣
    await request(app).post(`/v1/employer/recommendations/${rec.recommendation_id}/express-interest`).set('Authorization', `Bearer ${emp.api_key}`);
    // C 授权
    await request(app).post(`/v1/candidate/recommendations/${rec.recommendation_id}/approve-unlock`).set('Authorization', `Bearer ${cand.api_key}`);
    // E unlock
    await request(app).post(`/v1/employer/recommendations/${rec.recommendation_id}/unlock-contact`).set('Authorization', `Bearer ${emp.api_key}`);
    // E 创建 placement
    const placementRes = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${emp.api_key}`).send({
      anonymized_candidate_id: anondId, job_id: job.id, annual_salary: 1000000,
    });

    expect(placementRes.status).toBe(200);
    const p = placementRes.body.data;
    expect(p.primary_headhunter_id).toBe(hhB.id);  // 70% 给 B (推荐者)
    expect(p.referrer_headhunter_id).toBe(hhA.id);  // 30% 给 A (建岗者, 替代了 referral chain)
    // annual_salary=100万, platform_fee=20万, primary=14万, referrer=6万
    expect(p.platform_fee).toBe(100000);
    expect(p.primary_share).toBe(70000);
    expect(p.referrer_share).toBe(30000);
  });

  it('同人 (A 建, A 推荐): 100% A (避免自付)', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'pm', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hhA = (await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'HA', contact: 'ha@h.com' })).body.data;
    const cand = (await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' })).body.data;

    // A 建岗, 指定 E
    const job = (await request(app).post('/v1/headhunter/jobs').set('Authorization', `Bearer ${hhA.api_key}`).send({ title: 'J1', created_for_employer_id: emp.id })).body.data;
    // E 认领
    await request(app).post(`/v1/employer/claim-jobs/${job.id}`).set('Authorization', `Bearer ${emp.api_key}`);
    // A 上传候选人
    const candRes = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${hhA.api_key}`).send({
      candidate_user_id: cand.id, name: 'X', phone: '13800138000', email: 'x@x.com',
      current_company: '字节跳动',
      current_company: '字节跳动', current_title: 'P6',
      expected_salary: 600000, years_experience: 5, education_school: 'S', skills: ['React'],
    });
    const anondId = candRes.body.data.anonymized_id;
    // A 推荐候选人
    await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${hhA.api_key}`).send({ anonymized_candidate_id: anondId, job_id: job.id });
    const recList = await request(app).get('/v1/candidate/opportunities').set('Authorization', `Bearer ${cand.api_key}`);
    const rec = recList.body.data[0];
    await request(app).post(`/v1/employer/recommendations/${rec.recommendation_id}/express-interest`).set('Authorization', `Bearer ${emp.api_key}`);
    await request(app).post(`/v1/candidate/recommendations/${rec.recommendation_id}/approve-unlock`).set('Authorization', `Bearer ${cand.api_key}`);
    await request(app).post(`/v1/employer/recommendations/${rec.recommendation_id}/unlock-contact`).set('Authorization', `Bearer ${emp.api_key}`);
    const placementRes = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${emp.api_key}`).send({
      anonymized_candidate_id: anondId, job_id: job.id, annual_salary: 1000000,
    });

    expect(placementRes.status).toBe(200);
    const p = placementRes.body.data;
    expect(p.primary_headhunter_id).toBe(hhA.id);
    expect(p.referrer_headhunter_id).toBeNull();  // 同人: 无 referrer
    expect(p.platform_fee).toBe(100000);
    expect(p.primary_share).toBe(100000);  // 100%
    expect(p.referrer_share).toBe(0);
  });

  it('雇主直发 (E 建, B 推荐, 无 referrer): 100% B (老逻辑回归)', async () => {
    const app = createApp();
    const emp = (await request(app).post('/v1/auth/register').send({ user_type: 'pm', name: 'E1', contact: 'e1@e.com' })).body.data;
    const hhB = (await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'HB', contact: 'hb@h.com' })).body.data;
    const cand = (await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' })).body.data;

    // E 直接建岗
    const job = (await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${emp.api_key}`).send({ title: 'J1' })).body.data;
    // B 上传候选人
    const candRes = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${hhB.api_key}`).send({
      candidate_user_id: cand.id, name: 'X', phone: '13800138000', email: 'x@x.com',
      current_company: '字节跳动',
      current_company: '字节跳动', current_title: 'P6',
      expected_salary: 600000, years_experience: 5, education_school: 'S', skills: ['React'],
    });
    const anondId = candRes.body.data.anonymized_id;
    // B 推荐候选人
    await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${hhB.api_key}`).send({ anonymized_candidate_id: anondId, job_id: job.id });
    const recList = await request(app).get('/v1/candidate/opportunities').set('Authorization', `Bearer ${cand.api_key}`);
    const rec = recList.body.data[0];
    await request(app).post(`/v1/employer/recommendations/${rec.recommendation_id}/express-interest`).set('Authorization', `Bearer ${emp.api_key}`);
    await request(app).post(`/v1/candidate/recommendations/${rec.recommendation_id}/approve-unlock`).set('Authorization', `Bearer ${cand.api_key}`);
    await request(app).post(`/v1/employer/recommendations/${rec.recommendation_id}/unlock-contact`).set('Authorization', `Bearer ${emp.api_key}`);
    const placementRes = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${emp.api_key}`).send({
      anonymized_candidate_id: anondId, job_id: job.id, annual_salary: 1000000,
    });

    expect(placementRes.status).toBe(200);
    const p = placementRes.body.data;
    expect(p.primary_headhunter_id).toBe(hhB.id);
    expect(p.referrer_headhunter_id).toBeNull();  // 雇主直发 + 无 referral chain
    expect(p.platform_fee).toBe(100000);
    expect(p.primary_share).toBe(100000);
    expect(p.referrer_share).toBe(0);
  });
});
