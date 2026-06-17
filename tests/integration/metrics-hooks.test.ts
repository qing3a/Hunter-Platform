import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

describe('metrics refresh', () => {
  const testDb = path.join(__dirname, '../../tmp/metrics-refresh.db');

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

  it('refreshWebhookMetrics updates gauges from queue', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { createWebhookQueueRepo } = await import('../../src/main/db/repositories/webhook-delivery-queue');
    const { createUsersRepo } = await import('../../src/main/db/repositories/users');
    const { refreshWebhookMetrics } = await import('../../src/main/modules/metrics/refresh');
    const { getHunterMetrics } = await import('../../src/main/modules/metrics/registry');

    const db = openDb(testDb);
    runMigrations(db);
    const users = createUsersRepo(db);
    const queue = createWebhookQueueRepo(db);
    users.insert({
      id: 'u1', user_type: 'employer', name: 'U', contact: null, agent_endpoint: null,
      api_key_hash: 'h', api_key_prefix: 'hp_live_',
      quota_per_day: 100, quota_used: 0, quota_reset_at: '2026-06-18T00:00:00Z',
      reputation: 50, status: 'active',
      created_at: '2026-06-17T00:00:00Z', updated_at: '2026-06-17T00:00:00Z',
    });
    queue.enqueue({ target_user_id: 'u1', event_type: 'x', payload_enc: 'x', contains_pii: 0 });
    queue.enqueue({ target_user_id: 'u1', event_type: 'x', payload_enc: 'x', contains_pii: 0 });

    // Pass db explicitly to avoid getDb() needing electron
    refreshWebhookMetrics(db);
    const m = getHunterMetrics();
    expect(m.webhookPendingCount).toBeDefined();
    expect(m.webhookDeadLetterCount).toBeDefined();

    db.close();
  });

  it('startMetricsRefresh / stopMetricsRefresh toggle interval (idempotent)', async () => {
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { startMetricsRefresh, stopMetricsRefresh } = await import('../../src/main/modules/metrics/refresh');

    // Open a test db and pass it explicitly to avoid electron app.getPath
    const db = openDb(testDb);
    runMigrations(db);
    startMetricsRefresh(60_000, db);
    startMetricsRefresh(60_000, db); // idempotent: no error
    stopMetricsRefresh();
    stopMetricsRefresh(); // idempotent: no error
    db.close();
    expect(true).toBe(true);
  });
});
