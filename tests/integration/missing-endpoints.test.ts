/**
 * Integration tests for the 3 previously-missing endpoints (Bug 2):
 *  - GET /v1/users/:id/status
 *  - GET /v1/users/:id/history
 *  - GET /v1/candidate/access-log
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('previously-missing endpoints (Bug 2 regression)', () => {
  const testDb = path.join(__dirname, '../../tmp/missing-endpoints.db');
  let app: any;
  let candidateKey: string, candidateId: string, anonymizedId: string;
  let headhunterKey: string;
  let employerKey: string, employerId: string;
  let jobId: string, recId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // Setup: candidate, headhunter, employer
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    candidateKey = c.body.data.api_key; candidateId = c.body.data.id;
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = h.body.data.api_key;
    const e = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com' });
    employerKey = e.body.data.api_key; employerId = e.body.data.id;

    // Upload candidate
    const up = await request(app).post('/v1/headhunter/candidates').set('Authorization', `Bearer ${headhunterKey}`).send({
      candidate_user_id: candidateId, name: 'X', phone: '13800000000', email: 'x@x.com',
      current_company: '字节跳动', current_title: 'P6', expected_salary: 700000, years_experience: 8, education_school: '清华', skills: ['React'],
    });
    anonymizedId = up.body.data.anonymized_id;

    // Create job
    const job = await request(app).post('/v1/employer/jobs').set('Authorization', `Bearer ${employerKey}`).send({ title: 'Senior FE' });
    jobId = job.body.data.id;

    // Run 4-step unlock so we have audit data
    const rec = await request(app).post('/v1/headhunter/recommendations').set('Authorization', `Bearer ${headhunterKey}`).send({ anonymized_candidate_id: anonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    await request(app).post(`/v1/employer/recommendations/${recId}/express-interest`).set('Authorization', `Bearer ${employerKey}`);
    await request(app).post(`/v1/candidate/recommendations/${recId}/approve-unlock`).set('Authorization', `Bearer ${candidateKey}`);
    await request(app).post(`/v1/employer/recommendations/${recId}/unlock-contact`).set('Authorization', `Bearer ${employerKey}`);
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  // ====== GET /v1/users/:id/status ======
  describe('GET /v1/users/:id/status', () => {
    it('returns own user status with quota info', async () => {
      const r = await request(app).get(`/v1/users/${employerId}/status`).set('Authorization', `Bearer ${employerKey}`);
      expect(r.status).toBe(200);
      expect(r.body.data.id).toBe(employerId);
      expect(r.body.data.user_type).toBe('employer');
      expect(r.body.data.quota_per_day).toBe(100);  // employer default
      expect(r.body.data.quota_used).toBeGreaterThanOrEqual(0);
      // Sensitive fields NOT exposed
      expect(r.body.data.api_key_hash).toBeUndefined();
      expect(r.body.data.contact).toBeUndefined();
      expect(r.body.data.agent_endpoint).toBeUndefined();
    });

    it('rejects unauthenticated request', async () => {
      const r = await request(app).get(`/v1/users/${employerId}/status`);
      expect(r.status).toBe(401);
    });

    it('returns 404 for non-existent user', async () => {
      const r = await request(app).get('/v1/users/nonexistent/status').set('Authorization', `Bearer ${employerKey}`);
      expect(r.status).toBe(404);
    });
  });

  // ====== GET /v1/users/:id/history ======
  describe('GET /v1/users/:id/history', () => {
    it('returns own action history', async () => {
      const r = await request(app).get(`/v1/users/${employerId}/history`).set('Authorization', `Bearer ${employerKey}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
      // Note: action_history table is defined but no current handler writes to it
      // (v1 scope). The endpoint correctly returns an array (possibly empty).
      // v2 范围: hook all actions to write action_history.
    });

    it('rejects viewing other user\'s history (FORBIDDEN)', async () => {
      // employer tries to view candidate's history
      const r = await request(app).get(`/v1/users/${candidateId}/history`).set('Authorization', `Bearer ${employerKey}`);
      expect(r.status).toBe(403);
    });

    it('rejects unauthenticated', async () => {
      const r = await request(app).get(`/v1/users/${employerId}/history`);
      expect(r.status).toBe(401);
    });
  });

  // ====== GET /v1/candidate/access-log ======
  describe('GET /v1/candidate/access-log', () => {
    it('returns audit entries that targeted the candidate', async () => {
      const r = await request(app).get('/v1/candidate/access-log').set('Authorization', `Bearer ${candidateKey}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
      expect(r.body.data.length).toBeGreaterThan(0);
      // Should include express_interest (employer) and unlock_delivery (employer)
      const actions = r.body.data.map((e: any) => e.action);
      expect(actions).toContain('express_interest');
      expect(actions).toContain('unlock_delivery');
      // PII fields NOT leaked (only meta)
      for (const e of r.body.data) {
        expect(e).not.toHaveProperty('name');
        expect(e).not.toHaveProperty('phone');
        expect(e).not.toHaveProperty('email');
      }
    });

    it('rejects headhunter/employer (must be candidate)', async () => {
      const r1 = await request(app).get('/v1/candidate/access-log').set('Authorization', `Bearer ${headhunterKey}`);
      expect(r1.status).toBe(403);
      const r2 = await request(app).get('/v1/candidate/access-log').set('Authorization', `Bearer ${employerKey}`);
      expect(r2.status).toBe(403);
    });

    it('rejects unauthenticated', async () => {
      const r = await request(app).get('/v1/candidate/access-log');
      expect(r.status).toBe(401);
    });
  });
});
