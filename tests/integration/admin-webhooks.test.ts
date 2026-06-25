import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET /v1/admin/webhooks/dead-letter (Sub-D3 Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-subd3-webhooks-test.db');
  let app: any, db: any;
  let adminAuth = '';

  beforeAll(async () => {
    for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + s); } catch { /* */ }
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createAppFromDb } = await import('../../src/main/server');
    const { openDb } = await import('../../src/main/db/connection');
    const { runMigrations } = await import('../../src/main/db/migrations');
    const { loadEnv } = await import('../../src/main/env');
    db = openDb(testDb);
    runMigrations(db);
    app = createAppFromDb(db, loadEnv());

    const pwdHash = bcrypt.hashSync('admin-pwd', 4);
    const keyHash = bcrypt.hashSync('hp_admin_subd3_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_subd3', 'SubD3 Admin', 'subd3@test.com', pwdHash, keyHash, 'hp_admin_subd3_a', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'subd3@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;

    // Seed target users (FK requirement)
    for (let i = 0; i < 6; i++) {
      const uid = i < 5 ? `u_dl_${i}` : 'u_other';
      db.prepare(`INSERT OR IGNORE INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, 'candidate', ?, 't@x', ?, 'hp', 100, 0, datetime('now','+1 day'), 50, 'active',
        '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run(uid, `User ${uid}`, `h_${uid}`);
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(`INSERT OR IGNORE INTO users (id, user_type, name, contact, api_key_hash, api_key_prefix,
        quota_per_day, quota_used, quota_reset_at, reputation, status, created_at, updated_at)
        VALUES (?, 'candidate', ?, 't@x', ?, 'hp', 100, 0, datetime('now','+1 day'), 50, 'active',
        '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z')`).run(`u_p_${i}`, `User p ${i}`, `h_u_p_${i}`);
    }

    // Seed 5 dead-letter rows + 2 pending rows (to verify filter)
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO webhook_delivery_queue
        (target_user_id, event_type, payload_enc, status, attempt_count, last_error, created_at, updated_at)
        VALUES (?, ?, ?, 'dead_letter', ?, ?, ?, ?)`).run(
        `u_dl_${i}`, 'payment.succeeded', '{}', i + 1, `error ${i}`,
        '2026-06-25T00:00:00Z', new Date(Date.now() - i * 1000).toISOString()
      );
    }
    for (let i = 0; i < 2; i++) {
      db.prepare(`INSERT INTO webhook_delivery_queue
        (target_user_id, event_type, payload_enc, status, attempt_count, created_at, updated_at)
        VALUES (?, 'placement.created', '{}', 'pending', 0, ?, ?)`).run(
        `u_p_${i}`, '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
      );
    }
  });

  afterAll(() => { if (db) db.close(); });

  it('1. default returns paginated envelope of dead_letter only', async () => {
    const r = await request(app).get('/v1/admin/webhooks/dead-letter').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.pagination.total).toBe(5);
    expect(r.body.data).toHaveLength(5);
    expect(r.body.data.every((row: any) => row.event_type === 'payment.succeeded')).toBe(true);
  });

  it('2. event_type filter', async () => {
    // Add one dead-letter of different type
    db.prepare(`INSERT INTO webhook_delivery_queue
      (target_user_id, event_type, payload_enc, status, attempt_count, created_at, updated_at)
      VALUES ('u_other', 'placement.created', '{}', 'dead_letter', 1, ?, ?)`).run(
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const r = await request(app).get('/v1/admin/webhooks/dead-letter?event_type=placement.created').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(1);
    expect(r.body.data[0].event_type).toBe('placement.created');
  });

  it('3. min_attempt_count filter', async () => {
    const r = await request(app).get('/v1/admin/webhooks/dead-letter?min_attempt_count=3').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.every((row: any) => row.attempt_count >= 3)).toBe(true);
  });

  it('4. time range filter (updated_at)', async () => {
    // Get all current rows' updated_at, filter by a range
    const fromTs = new Date(Date.now() - 3 * 1000).toISOString();
    const r = await request(app).get(`/v1/admin/webhooks/dead-letter?from=${encodeURIComponent(fromTs)}`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('5. POST /webhooks/:id/retry → status=pending', async () => {
    const id = (db.prepare("SELECT id FROM webhook_delivery_queue WHERE status = 'dead_letter' LIMIT 1").get() as any).id;
    const r = await request(app).post(`/v1/admin/webhooks/${id}/retry`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id, status: 'pending' });
    // Verify DB updated
    const updated = db.prepare('SELECT status FROM webhook_delivery_queue WHERE id = ?').get(id) as any;
    expect(updated.status).toBe('pending');
  });

  it('6. retry non-existent → 404', async () => {
    const r = await request(app).post('/v1/admin/webhooks/99999/retry').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('7. retry writes admin_action_log row (Sub-D4)', async () => {
    const id = (db.prepare("SELECT id FROM webhook_delivery_queue WHERE status = 'dead_letter' LIMIT 1").get() as any).id;
    const beforeCount = (db.prepare("SELECT COUNT(*) AS c FROM admin_action_log WHERE action = 'retry_webhook'").get() as { c: number }).c;

    const r = await request(app).post(`/v1/admin/webhooks/${id}/retry`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);

    const afterCount = (db.prepare("SELECT COUNT(*) AS c FROM admin_action_log WHERE action = 'retry_webhook'").get() as { c: number }).c;
    expect(afterCount).toBe(beforeCount + 1);

    const log = db.prepare(`SELECT * FROM admin_action_log WHERE target_id = ? AND action = 'retry_webhook' ORDER BY id DESC LIMIT 1`).get(String(id)) as any;
    expect(log).toBeTruthy();
    expect(log.admin_user_id).toBeTruthy();
    const details = JSON.parse(log.details_json);
    expect(details).toHaveProperty('event_type');
    expect(details).toHaveProperty('target_user_id');
    expect(details).toHaveProperty('previous_attempt_count');
  });
});