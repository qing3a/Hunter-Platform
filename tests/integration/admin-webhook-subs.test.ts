import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

describe('GET/POST/PATCH/DELETE /v1/admin/webhook-subscriptions (Sub-E Plan 1)', () => {
  const testDb = path.join(__dirname, '../../tmp/admin-sube-webhook-subs-test.db');
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
    const keyHash = bcrypt.hashSync('hp_admin_sube_aaaa', 4);
    db.prepare(`INSERT INTO admin_users (id, name, email, password_hash, api_key_hash, api_key_prefix, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'adm_sube', 'SubE Admin', 'sube@test.com', pwdHash, keyHash, 'hp_admin_sube_aa', 'super', 'active',
      '2026-06-25T00:00:00Z', '2026-06-25T00:00:00Z'
    );
    const lr = await request(app).post('/v1/admin/auth/login').send({ email: 'sube@test.com', password: 'admin-pwd' });
    adminAuth = `Bearer ${lr.body.data.api_key}`;
  });

  afterAll(() => { if (db) db.close(); });

  it('1. GET returns empty list initially', async () => {
    const r = await request(app).get('/v1/admin/webhook-subscriptions').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('2. POST creates subscription with audit log', async () => {
    const r = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://example.com/webhook', event_types: ['placement.paid', 'candidate.unlocked'] });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBeGreaterThan(0);
    expect(r.body.data.target_url).toBe('https://example.com/webhook');
    expect(r.body.data.event_types).toEqual(['placement.paid', 'candidate.unlocked']);
    expect(r.body.data.enabled).toBe(true);

    // Verify audit log written
    const log = db.prepare(`SELECT * FROM admin_action_log WHERE action = 'create_webhook_subscription' ORDER BY id DESC LIMIT 1`).get() as any;
    expect(log).toBeTruthy();
    expect(log.target_id).toBe(String(r.body.data.id));
  });

  it('3. POST rejects invalid target_url', async () => {
    const r = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'ftp://invalid', event_types: ['x'] });
    expect(r.status).toBe(400);
  });

  it('4. POST rejects empty event_types', async () => {
    const r = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://example.com', event_types: [] });
    expect(r.status).toBe(400);
  });

  it('5. PATCH updates target_url', async () => {
    // First create
    const create = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://old.com', event_types: ['x'] });
    const id = create.body.data.id;
    // Then update
    const r = await request(app).patch(`/v1/admin/webhook-subscriptions/${id}`)
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://new.com' });
    expect(r.status).toBe(200);
    expect(r.body.data.target_url).toBe('https://new.com');
  });

  it('6. PATCH non-existent → 404', async () => {
    const r = await request(app).patch('/v1/admin/webhook-subscriptions/99999')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://x.com' });
    expect(r.status).toBe(404);
  });

  it('7. DELETE removes subscription with audit log', async () => {
    const create = await request(app).post('/v1/admin/webhook-subscriptions')
      .set('Authorization', adminAuth)
      .send({ target_url: 'https://todelete.com', event_types: ['x'] });
    const id = create.body.data.id;
    const r = await request(app).delete(`/v1/admin/webhook-subscriptions/${id}`).set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    // Verify gone
    const get = await request(app).get('/v1/admin/webhook-subscriptions').set('Authorization', adminAuth);
    expect(get.body.data.find((s: any) => s.id === id)).toBeUndefined();
    // Verify audit
    const log = db.prepare(`SELECT * FROM admin_action_log WHERE action = 'delete_webhook_subscription' AND target_id = ?`).get(String(id)) as any;
    expect(log).toBeTruthy();
  });

  it('8. DELETE non-existent → 404', async () => {
    const r = await request(app).delete('/v1/admin/webhook-subscriptions/99999').set('Authorization', adminAuth);
    expect(r.status).toBe(404);
  });

  it('9. GET list returns created subscriptions', async () => {
    const r = await request(app).get('/v1/admin/webhook-subscriptions').set('Authorization', adminAuth);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data[0]).toHaveProperty('event_types');
    expect(r.body.data[0].event_types).toBeInstanceOf(Array);
  });

  it('10. no auth → 401', async () => {
    const r = await request(app).get('/v1/admin/webhook-subscriptions');
    expect(r.status).toBe(401);
  });
});
