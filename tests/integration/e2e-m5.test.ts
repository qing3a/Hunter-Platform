import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('M5 E2E: metrics + versioned crypto', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m5.db');

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

  it('GET /metrics returns Prometheus format with hunter_* metrics', async () => {
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    await request(app).get('/v1/health');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('# HELP');
    expect(res.text).toContain('hunter_http_requests_total');
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });

  it('GET /v1/metrics also works (alias)', async () => {
    const { createApp } = await import('../../src/main/server');
    const app = createApp();
    const res = await request(app).get('/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('hunter_http_request_duration_seconds');
  });

  it('encrypted candidate data has v1: prefix in storage', async () => {
    const { createApp } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const app = createApp();
    const h = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H', contact: 'h@x.com' });
    const c = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C', contact: 'c@x.com' });
    await request(app)
      .post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${h.body.data.api_key}`)
      .send({
        candidate_user_id: c.body.data.id, name: 'X', phone: '13800000000', email: 'x@x.com', current_company: '字节跳动',
      });
    const db = openDb(testDb);
    const row = db.prepare('SELECT name_enc FROM candidates_private LIMIT 1').get() as { name_enc: string };
    db.close();
    expect(row.name_enc.startsWith('v1:')).toBe(true);
  });
});

describe('M5 E2E: multi-key env (P1#13)', () => {
  const testDb = path.join(__dirname, '../../tmp/e2e-m5-multikey.db');

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal'); } catch {} try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });
  afterEach(() => {
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal'); } catch {} try { fs.unlinkSync(testDb + '-shm'); } catch {}
  });

  it('PLATFORM_ENCRYPTION_KEYS multi-key env is parsed and latest is used', async () => {
    const k1 = crypto.randomBytes(32).toString('base64');
    const k2 = crypto.randomBytes(32).toString('base64');
    process.env.PLATFORM_ENCRYPTION_KEY = k1; // legacy fallback
    process.env.PLATFORM_ENCRYPTION_KEYS = `v1:${k1},v2:${k2}`;
    process.env.WEBHOOK_HMAC_SECRET = 'test-test-test-test';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';

    const { loadEnv } = await import('../../src/main/env');
    const env = loadEnv();
    expect(env.encryptionKeyMap.size).toBe(2);
    expect(env.encryptionKeyMap.get('v1')?.toString('base64')).toBe(k1);
    expect(env.encryptionKeyMap.get('v2')?.toString('base64')).toBe(k2);
    // Latest (v2) is used for new encryptions
    expect(env.PLATFORM_ENCRYPTION_KEY.toString('base64')).toBe(k2);
  });
});
