import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('admin:webhooks', () => {
  const testDb = path.join(__dirname, '../../../tmp/wh-ipc.db');
  let db: any, wh: any, whIpc: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createWebhookQueueRepo } = await import('../../../src/main/db/repositories/webhook-delivery-queue');
    const { createWebhooksIpc } = await import('../../../src/main/ipc/webhooks');
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const users = createUsersRepo(db);
    users.insert({ id: 'u1', user_type: 'employer', name: 'U', contact: null, agent_endpoint: 'https://x/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z' });
    wh = createWebhookQueueRepo(db);
    whIpc = createWebhooksIpc(db);
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0, max_attempts: 1 });
    db.prepare("UPDATE webhook_delivery_queue SET status = 'dead_letter', attempt_count = 1, next_retry_at = NULL WHERE id = 1").run();
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} try { fs.unlinkSync(testDb + '-wal') } catch {} try { fs.unlinkSync(testDb + '-shm') } catch {} });

  it('listDeadLetter returns only dead_letter rows', () => {
    const list = whIpc.listDeadLetter(50);
    expect(list.length).toBe(1);
    expect((list[0] as any).status).toBe('dead_letter');
  });

  it('retry resets status to pending', () => {
    const result = whIpc.retry(1);
    expect(result.status).toBe('pending');
    const row = db.prepare("SELECT * FROM webhook_delivery_queue WHERE id = 1").get();
    expect((row as any).status).toBe('pending');
  });
});