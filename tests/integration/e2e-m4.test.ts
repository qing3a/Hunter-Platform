import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('M4 E2E: placement + GDPR + admin billing', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m4.db');
  let app: any;
  let employerKey = '';
  let employerId = '';
  let headhunterKey = '';
  let candidateKey = '';
  let candidateId = '';
  let jobId = '';
  let anonymizedId = '';
  let recId = '';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let placementId = '';

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // Setup: 3 users + candidate + job + recommendation + 4-step unlock
    const e = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    employerKey = e.body.data.api_key;
    employerId = e.body.data.user_id;
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = h.body.data.api_key;
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candidateKey = c.body.data.api_key;
    candidateId = c.body.data.user_id;
    const up = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: candidateId,
        name: '张三',
        phone: '13800138000',
        email: 'z@x.com',
        current_company: '字节跳动',
        current_title: 'P6',
        expected_salary: 800000,
        years_experience: 8,
        education_school: '清华',
        skills: ['React'],
      });
    anonymizedId = up.body.data.anonymized_id;
    const job = await request(app)
      .post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({ title: 'Senior FE' });
    jobId = job.body.data.id;
    const rec = await request(app)
      .post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({ anonymized_candidate_id: anonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    await request(app)
      .post(`/v1/employer/recommendations/${recId}/express-interest`)
      .set('Authorization', `Bearer ${employerKey}`);
    await request(app)
      .post(`/v1/candidate/recommendations/${recId}/approve-unlock`)
      .set('Authorization', `Bearer ${candidateKey}`);
    await request(app)
      .post(`/v1/employer/recommendations/${recId}/unlock-contact`)
      .set('Authorization', `Bearer ${employerKey}`);
  });
  afterAll(() => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('employer creates placement with computed commission', async () => {
    const r = await request(app)
      .post('/v1/employer/placements')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({
        anonymized_candidate_id: anonymizedId,
        job_id: jobId,
        annual_salary: 1_200_000,
      });
    expect(r.status).toBe(200);
    expect(r.body.data.platform_fee).toBe(240_000);
    expect(r.body.data.primary_share).toBe(240_000);
    expect(r.body.data.status).toBe('pending_payment');
    placementId = r.body.data.id;
  });

  it('rejects duplicate placement (P1#4)', async () => {
    const r = await request(app)
      .post('/v1/employer/placements')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({
        anonymized_candidate_id: anonymizedId,
        job_id: jobId,
        annual_salary: 1_200_000,
      });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('candidate can export all their data (GDPR)', async () => {
    const r = await request(app)
      .get('/v1/candidate/export-my-data')
      .set('Authorization', `Bearer ${candidateKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.user.id).toBe(candidateId);
    expect(r.body.data.candidates_private.length).toBeGreaterThan(0);
    expect(r.body.data.candidates_private[0].name).toBe('张三'); // decrypted
    expect(r.body.data.candidates_private[0].phone).toBe('13800138000');
  });

  it('GET /v1/openapi.json returns valid OpenAPI 3.0', async () => {
    const r = await request(app).get('/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.0.0');
    expect(r.body.paths['/v1/employer/placements']).toBeDefined();
  });
});
