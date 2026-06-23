import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('POST /v1/employer/placements', () => {
  const testDb = path.join(__dirname, '../../tmp/emp-place.db');
  let app: any, employerKey: string, headhunterKey: string, candidateId: string, jobId: string, anonymizedId: string, recId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    const e = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    employerKey = e.body.data.api_key;
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = h.body.data.api_key;
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candidateId = c.body.data.id;

    const up = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${headhunterKey}`).send({
      candidate_user_id: candidateId, name: 'X', phone: '13800000000', email: 'x@x.com',
      current_company: '字节跳动',
      current_company: '字节跳动', current_title: 'P6', expected_salary: 700000, years_experience: 8,
      education_school: '清华', skills: ['React'],
    });
    anonymizedId = up.body.data.anonymized_id;
    const job = await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${employerKey}`).send({ title: 'A' });
    jobId = job.body.data.id;
    const rec = await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${headhunterKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    await request(app).post(`/v1/employer/recommendations/${recId}/express-interest`).set('Authorization', `Bearer ${employerKey}`);
    await request(app).post(`/v1/candidate/recommendations/${recId}/approve-unlock`).set('Authorization', `Bearer ${c.body.data.api_key}`);
    await request(app).post(`/v1/employer/recommendations/${recId}/unlock-contact`).set('Authorization', `Bearer ${employerKey}`);
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('creates placement with computed commission', async () => {
    const r = await request(app)
      .post('/v1/employer/placements')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    expect(r.status).toBe(200);
    expect(r.body.data.platform_fee).toBe(200_000);
    expect(r.body.data.primary_share).toBe(200_000);
    expect(r.body.data.status).toBe('pending_payment');
  });

  it('rejects non-employer', async () => {
    const r = await request(app)
      .post('/v1/employer/placements')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    expect(r.status).toBe(403);
  });

  it('rejects duplicate with DUPLICATE_REQUEST error code (P1#4 UNIQUE)', async () => {
    await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${employerKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    const r = await request(app).post('/v1/employer/placements').set('Authorization', `Bearer ${employerKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId, annual_salary: 1_000_000 });
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe('DUPLICATE_REQUEST');
    // 错误消息不应暴露内部 SQLite 信息
    expect(r.body.error.message).not.toContain('SQLite');
    expect(r.body.error.message).not.toContain('UNIQUE');
  });
});