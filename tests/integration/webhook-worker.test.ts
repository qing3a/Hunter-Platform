import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

describe('webhook worker', () => {
  const testDb = path.join(__dirname, '../../tmp/wh-worker.db');
  let db: any, users: any, wh: any, worker: any, encryptionKey: Buffer;
  let server: any, receivedPayloads: any[], receivedHeaders: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { createWebhookQueueRepo } = await import('../../src/main/db/repositories/webhook-delivery-queue');
    const { createWebhookWorker } = await import('../../src/main/modules/webhook/worker');
    users = createUsersRepo(db);
    wh = createWebhookQueueRepo(db);
    worker = createWebhookWorker(db, { batchSize: 5 });
    encryptionKey = (await import('node:crypto')).randomBytes(32);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'pm', name: 'E', contact: null, agent_endpoint: 'http://localhost:9876/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });

    receivedPayloads = [];
    receivedHeaders = null;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        receivedPayloads.push(JSON.parse(body));
        receivedHeaders = req.headers;
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>(resolve => server.listen(9876, resolve));
  });
  afterEach(async () => {
    db.close();
    await new Promise<void>(resolve => server.close(resolve));
    try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {}
  });

  it('delivers pending webhook with HMAC signature', async () => {
    const { encrypt } = await import('../../src/main/modules/crypto/aes-gcm');
    const payloadEnc = encrypt(encryptionKey, JSON.stringify({ type: 'test', data: 'hello' }));
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: payloadEnc, contains_pii: 0 });

    const SECRET = 'test-secret-1234567890';
    const result = await worker.processBatch(encryptionKey, { hmacSecret: SECRET });
    expect(result.delivered).toBe(1);
    expect(receivedPayloads.length).toBe(1);
    expect(receivedPayloads[0].data).toBe('hello');
    expect(receivedHeaders['x-hunter-signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(receivedHeaders['x-hunter-timestamp']).toBeDefined();
  });

  it('marks dead_letter after max_attempts', async () => {
    const deadServer = http.createServer(() => { /* never respond */ });
    await new Promise<void>(resolve => deadServer.listen(9877, resolve));
    db.prepare("UPDATE users SET agent_endpoint = 'http://localhost:9877/dead' WHERE id = 'u1'").run();
    const { encrypt } = await import('../../src/main/modules/crypto/aes-gcm');
    const payloadEnc = encrypt(encryptionKey, JSON.stringify({ type: 'test' }));
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: payloadEnc, contains_pii: 0, max_attempts: 2 });

    await worker.processBatch(encryptionKey, { hmacSecret: 'test', timeoutMs: 500 });
    db.prepare("UPDATE webhook_delivery_queue SET next_retry_at = NULL WHERE status = 'pending'").run();
    await worker.processBatch(encryptionKey, { hmacSecret: 'test', timeoutMs: 500 });
    const rec = wh.findById(1);
    expect(rec?.status).toBe('dead_letter');
    await new Promise<void>(resolve => deadServer.close(resolve));
  });
});
