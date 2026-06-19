import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

describe('GET /v1/skill.md', () => {
  const testDb = path.join(__dirname, '../../tmp/skill.db');

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('returns skill.md content as markdown', async () => {
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    const res = await request(app).get('/v1/skill.md');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    // skill.md 当前标题包含 emoji 前缀；用通用 marker 检查
    expect(res.text).toContain('Hunter Platform');
    expect(res.text).toContain('Agent Skill');
  });

  it('/skill.md redirects to /v1/skill.md', async () => {
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    const res = await request(app).get('/skill.md');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/v1/skill.md');
  });
});