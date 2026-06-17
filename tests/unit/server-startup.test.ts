import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

describe('startApiServer', () => {
  const testDb = path.join(__dirname, '../../tmp/startup.db');
  let server: any;

  beforeEach(() => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
  });
  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('exports startApiServer that returns an http.Server', async () => {
    const { startApiServer } = await import('../../src/main/server');
    server = await startApiServer({ port: 0 });
    expect(server.listening).toBe(true);
  });

  it('health endpoint returns ok', async () => {
    const { startApiServer } = await import('../../src/main/server');
    server = await startApiServer({ port: 0 });
    const addr = server.address() as any;
    const res = await new Promise<any>((resolve, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/v1/health`, (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => resolve({ status: r.statusCode, body }));
      }).on('error', reject);
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).data.status).toBe('healthy');
  });
});