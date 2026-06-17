import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('webhook_delivery_queue repository', () => {
  const testDb = path.join(__dirname, '../../../tmp/wh.db');
  let db: any, users: any, wh: any;

  beforeEach(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    const { openDb } = await import('../../../src/main/db/connection');
    const { runMigrations } = await import('../../../src/main/db/migrations');
    db = openDb(testDb);
    runMigrations(db);
    const { createUsersRepo } = await import('../../../src/main/db/repositories/users');
    const { createWebhookQueueRepo } = await import('../../../src/main/db/repositories/webhook-delivery-queue');
    users = createUsersRepo(db);
    wh = createWebhookQueueRepo(db);
    const now = '2026-06-17T00:00:00Z';
    users.insert({ id: 'u1', user_type: 'employer', name: 'E', contact: null, agent_endpoint: 'https://e.example.com/wh', api_key_hash: 'h', api_key_prefix: 'hp_live_', quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z', reputation: 50, status: 'active', created_at: now, updated_at: now });
  });
  afterEach(() => { db.close(); try { fs.unlinkSync(testDb); } catch {} });

  it('enqueues with encrypted payload', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'deliver_contact', payload_enc: 'base64ciphertext', contains_pii: 1 });
    const pending = wh.fetchPending(new Date().toISOString());
    expect(pending.length).toBe(1);
    expect(pending[0].event_type).toBe('deliver_contact');
    expect(pending[0].contains_pii).toBe(1);
  });

  it('marks success and removes from pending', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0 });
    const pending = wh.fetchPending(new Date().toISOString());
    wh.markSuccess(pending[0].id);
    const after = wh.fetchPending(new Date().toISOString());
    expect(after.length).toBe(0);
  });

  it('increments attempt and sets next_retry_at on failure', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0 });
    const pending = wh.fetchPending(new Date().toISOString());
    const nextRetry = new Date(Date.now() + 1000).toISOString();
    wh.markFailed(pending[0].id, 'Connection timeout', nextRetry);
    const reloaded = wh.findById(pending[0].id);
    expect(reloaded?.attempt_count).toBe(1);
    expect(reloaded?.last_error).toBe('Connection timeout');
  });

  it('marks dead_letter after max_attempts', () => {
    wh.enqueue({ target_user_id: 'u1', event_type: 'notify_unlock_request', payload_enc: 'x', contains_pii: 0, max_attempts: 2 });
    const pending = wh.fetchPending(new Date().toISOString());
    wh.markFailed(pending[0].id, 'err1', new Date(Date.now() + 1000).toISOString());
    wh.markFailed(pending[0].id, 'err2', new Date(Date.now() + 1000).toISOString());
    const final = wh.findById(pending[0].id);
    expect(final?.status).toBe('dead_letter');
  });
});
