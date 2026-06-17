import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('HTTP metrics middleware', () => {
  const testDb = path.join(__dirname, '../../tmp/metrics.db');

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal'); } catch {} try { fs.unlinkSync(testDb + '-shm'); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-test-test-test';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal'); } catch {} try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('records HTTP request duration and total count', async () => {
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    await request(app).get('/v1/health');
    await request(app).get('/v1/health');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/hunter_http_requests_total\{[^}]*route="\/v1\/health"[^}]*status="200"[^}]*\} 2/);
    expect(res.text).toMatch(/hunter_http_request_duration_seconds_count\{[^}]*route="\/v1\/health"[^}]*\} 2/);
  });

  it('does not record /metrics endpoint itself (avoid recursion)', async () => {
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    await request(app).get('/metrics');
    await request(app).get('/metrics');
    const res = await request(app).get('/metrics');
    expect(res.text).not.toMatch(/route="\/metrics"/);
  });
});
