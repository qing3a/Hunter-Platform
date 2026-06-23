import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/headhunter/candidates - current_company required', () => {
  const testDb = path.join(__dirname, '../../tmp/hp-cc-test.db');
  let app: any;
  let db: any;
  let headhunterApiKey: string;
  let candidateUserId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    try { fs.unlinkSync(testDb + '-wal'); } catch {}
    try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    // Register headhunter via /v1/auth/register (this is the proper auth pattern)
    const hhReg = await request(app).post('/v1/auth/register').send({
      user_type: 'headhunter',
      name: 'Test HH',
      contact: 'hh@test.com',
    });
    if (hhReg.status !== 200) throw new Error(`headhunter register failed: ${JSON.stringify(hhReg.body)}`);
    headhunterApiKey = hhReg.body.data.api_key;

    // Register candidate (so candidate_user_id exists)
    const candReg = await request(app).post('/v1/auth/register').send({
      user_type: 'candidate',
      name: 'Test Candidate',
      contact: 'cand@test.com',
    });
    candidateUserId = candReg.body.data.id;
  });

  afterAll(() => { if (db) db.close(); });

  const validInput = () => ({
    candidate_user_id: candidateUserId,
    name: '张三',
    phone: '13800000000',
    email: 'zhang@test.com',
    current_company: '字节跳动',
    current_title: '高级工程师',
  });

  // ---- 400 cases ----
  it('400 when current_company field is missing', async () => {
    const { current_company, ...inputWithoutCompany } = validInput();
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send(inputWithoutCompany);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  it('400 when current_company is empty string', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send({ ...validInput(), current_company: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMS');
  });

  // ---- 200 cases (industry != null) ----
  it('200 when current_company is known (字节跳动 → 互联网)', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send(validInput());
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('互联网');
  });

  it('200 when current_company is unknown → fallback 其他', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send({ ...validInput(), current_company: '某无人知晓的工作室' });
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('其他');
  });

  it('200 when current_company matches keyword fallback (某科技公司 → 互联网)', async () => {
    const res = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterApiKey}`)
      .send({ ...validInput(), current_company: '深圳某科技公司' });
    expect(res.status).toBe(200);
    expect(res.body.data.preview.industry).toBe('互联网');
  });
});