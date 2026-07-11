import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/employer-jobs-body.db');
let app: any;
let empKey: string;

describe('POST /v1/employer/jobs — body limit allows large description', () => {
  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();
    const reg = await request(app).post('/v1/auth/register')
      .send({ user_type: 'pm', name: 'E', contact: 'e@x.com' });
    empKey = reg.body.data.api_key;
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('accepts 5000-char Chinese description (~15KB UTF-8)', async () => {
    const desc = '高级前端工程师岗位，'.repeat(500); // 500 * 10 chars = 5000 chars
    const res = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empKey}`)
      .send({ title: 'P6', description: desc });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('still rejects 5001-char description (zod max(5000))', async () => {
    const desc = 'a'.repeat(5001);
    const res = await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empKey}`)
      .send({ title: 'P6', description: desc });
    expect(res.status).toBe(400);
  });
});