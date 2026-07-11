import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('POST /v1/headhunter/candidates', () => {
  const testDb = path.join(__dirname, '../../tmp/upload.db');
  let app: any, headhunterKey: string, candidateId: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // 预创建猎头 + 候选人，从 register 响应中拿到 user_id
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'hr', name: 'H', contact: 'h1-upload@x.com' });
    headhunterKey = h.body.data.api_key;
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c1-upload@x.com' });
    candidateId = c.body.data.id;
  });
  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('uploads and desensitizes candidate', async () => {
    const r = await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${headhunterKey}`)
      .send({
        candidate_user_id: candidateId,
        name: '张三',
        phone: '13800138000',
        email: 'z@x.com',
        current_company: '字节跳动',
        current_title: '高级前端工程师',
        expected_salary: 750000,
        years_experience: 8,
        education_school: '清华大学',
        skills: ['React', 'TypeScript'],
      });
    expect(r.status).toBe(200);
    expect(r.body.data.preview.industry).toBe('互联网');
    expect(r.body.data.preview.title_level).toBe('P6');
    expect(r.body.data.preview.salary_range).toBe('60-80万');
    // PII 绝对不返回
    expect(r.body.data.preview).not.toHaveProperty('name');
    expect(r.body.data.preview).not.toHaveProperty('phone');
    expect(r.body.data.preview).not.toHaveProperty('email');
  });

  it('rejects unauthenticated request', async () => {
    const r = await request(app).post('/v1/headhunter/candidates').send({});
    expect(r.status).toBe(401);
  });
});
