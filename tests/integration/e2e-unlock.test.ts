import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

describe('M2 E2E: 4-step unlock flow', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m2.db');
  let app: any;
  let employerKey: string, employerId: string;
  let headhunterKey: string, headhunterId: string;
  let candidateKey: string, candidateId: string;
  let candidateAnonymizedId: string;
  let jobId: string;
  let recId: string;
  let employerWh: { payloads: any[]; server: any };
  let candidateWh: { payloads: any[]; server: any };

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    const startWh = (port: number) => {
      const payloads: any[] = [];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => { try { payloads.push(JSON.parse(body)); } catch {} res.statusCode = 200; res.end('ok'); });
      });
      return new Promise<any>(resolve => server.listen(port, () => resolve({ payloads, server })));
    };
    employerWh = await startWh(9870);
    candidateWh = await startWh(9871);

    const emp = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E', contact: 'e@x.com', agent_endpoint: 'http://localhost:9870/wh' });
    employerKey = emp.body.data.api_key;
    employerId = emp.body.data.user_id;
    const hun = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    headhunterKey = hun.body.data.api_key;
    headhunterId = hun.body.data.user_id;
    const can = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com', agent_endpoint: 'http://localhost:9871/wh' });
    candidateKey = can.body.data.api_key;
    candidateId = can.body.data.user_id;

    const upload = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: candidateId,
        name: '张三', phone: '13800138000', email: 'z@x.com',
        current_company: '字节跳动', current_title: '高级前端',
        expected_salary: 750000, years_experience: 8,
        education_school: '清华大学', skills: ['React'],
      });
    candidateAnonymizedId = upload.body.data.anonymized_id;

    await request(app)
      .post(`/v1/headhunter/candidates/${candidateAnonymizedId}/publish-to-pool`)
      .set('Authorization', `Bearer ${headhunterKey}`);

    const job = await request(app)
      .post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${employerKey}`)
      .send({ title: 'Senior FE', salary_min: 500000, salary_max: 800000, industry: '互联网' });
    jobId = job.body.data.id;

    const rec = await request(app)
      .post('/v1/headhunter/recommendations')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({ anonymized_candidate_id: candidateAnonymizedId, job_id: jobId });
    recId = rec.body.data.id;
    expect(rec.body.data.status).toBe('pending');
  });
  afterAll(async () => {
    employerWh.server.close();
    candidateWh.server.close();
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('Step 2: employer express_interest → employer_interested + webhook to candidate', async () => {
    const r = await request(app)
      .post(`/v1/employer/recommendations/${recId}/express-interest`)
      .set('Authorization', `Bearer ${employerKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('employer_interested');

    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite') as typeof import('node:sqlite');
    const conn = new DatabaseSync(testDb);
    const { createWebhookWorker } = await import('../../src/main/modules/webhook/worker');
    const worker = createWebhookWorker(conn);
    const { loadEnv } = await import('../../src/main/env');
    const env = loadEnv();
    await worker.processBatch(env.PLATFORM_ENCRYPTION_KEY, { hmacSecret: env.WEBHOOK_HMAC_SECRET });
    conn.close();
    expect(candidateWh.payloads.some(p => p.recommendation_id === recId)).toBe(true);
  });

  it('Step 3: candidate approve_unlock → candidate_approved', async () => {
    const r = await request(app)
      .post(`/v1/candidate/recommendations/${recId}/approve-unlock`)
      .set('Authorization', `Bearer ${candidateKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('candidate_approved');
  });

  it('Step 4: employer unlock_contact → unlocked + deliver_contact webhook', async () => {
    const r = await request(app)
      .post(`/v1/employer/recommendations/${recId}/unlock-contact`)
      .set('Authorization', `Bearer ${employerKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('unlocked');

    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite') as typeof import('node:sqlite');
    const conn = new DatabaseSync(testDb);
    const { createWebhookWorker } = await import('../../src/main/modules/webhook/worker');
    const worker = createWebhookWorker(conn);
    const { loadEnv } = await import('../../src/main/env');
    const env = loadEnv();
    const result = await worker.processBatch(env.PLATFORM_ENCRYPTION_KEY, { hmacSecret: env.WEBHOOK_HMAC_SECRET });
    conn.close();
    expect(result.delivered).toBeGreaterThan(0);
    expect(employerWh.payloads.some(p => p.event_type === 'deliver_contact' || p.candidate_id)).toBe(true);
  });

  it('audit log captures all 3 steps', async () => {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req('node:sqlite') as typeof import('node:sqlite');
    const conn = new DatabaseSync(testDb, { readonly: true });
    const entries = conn.prepare("SELECT action, actor_user_id FROM unlock_audit_log WHERE recommendation_id = ? ORDER BY id ASC").all(recId) as any[];
    conn.close();
    const actions = entries.map(e => e.action);
    expect(actions).toContain('express_interest');
    expect(actions).toContain('approve_unlock');
    expect(actions).toContain('unlock_delivery');
  });
});
