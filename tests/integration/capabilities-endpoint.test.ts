import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

const testDb = path.join(__dirname, '../../tmp/capabilities-endpoint.db');
let app: any;

beforeAll(async () => {
  // Wipe the DB before the suite starts. Tests share the same DB (each
  // test uses unique contacts to avoid contact-taken conflicts).
  try { fs.unlinkSync(testDb); } catch {}
  try { fs.unlinkSync(testDb + '-wal'); } catch {}
  try { fs.unlinkSync(testDb + '-shm'); } catch {}
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
  process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuv';
  process.env.DATABASE_PATH = testDb;
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../../src/main/server');
  app = createApp();
});
afterAll(() => {
  try { fs.unlinkSync(testDb); } catch {}
  try { fs.unlinkSync(testDb + '-wal'); } catch {}
  try { fs.unlinkSync(testDb + '-shm'); } catch {}
});

async function registerHeadhunter(contact: string, name = 'T') {
  const r = await request(app).post('/v1/auth/register')
    .send({ user_type: 'headhunter', name, contact });
  return { apiKey: r.body.data.api_key as string, userId: r.body.data.id as string };
}

async function registerCandidate(contact: string, name = 'C') {
  const r = await request(app).post('/v1/auth/register')
    .send({ user_type: 'candidate', name, contact });
  return { apiKey: r.body.data.api_key as string, userId: r.body.data.id as string };
}

describe('GET /v1/capabilities', () => {
  it('public, lists all capability sets', async () => {
    const r = await request(app).get('/v1/capabilities');
    expect(r.status).toBe(200);
    expect(r.body.data.sets.length).toBeGreaterThanOrEqual(5);  // auth, headhunter, employer, candidate, admin
    const roles = r.body.data.sets.map((s: any) => s.role);
    expect(roles).toContain('headhunter');
    expect(roles).toContain('employer');
    expect(roles).toContain('candidate');
    expect(roles).toContain('admin');
    expect(roles).toContain('auth');
  });

  it('each capability has name, method, path, quota_cost', async () => {
    const r = await request(app).get('/v1/capabilities');
    const headhunter = r.body.data.sets.find((s: any) => s.role === 'headhunter');
    expect(headhunter.capabilities.length).toBeGreaterThanOrEqual(5);
    for (const cap of headhunter.capabilities) {
      // Allow optional 3-part names (e.g. headhunter.recommendations.list_pending_pickup)
      expect(cap.name).toMatch(/^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$/);
      expect(cap.method).toMatch(/^(GET|POST|PUT|DELETE)$/);
      expect(cap.path).toMatch(/^\/v1\//);
      expect(typeof cap.quota_cost).toBe('number');
    }
  });
});

describe('GET /v1/capabilities/me', () => {
  it('requires auth (401 without bearer)', async () => {
    const r = await request(app).get('/v1/capabilities/me');
    expect(r.status).toBe(401);
  });

  it('returns user quota + capabilities list', async () => {
    const { apiKey } = await registerHeadhunter('a@x.com', 'A');

    const r = await request(app).get('/v1/capabilities/me')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.user_type).toBe('headhunter');
    expect(r.body.data.status).toBe('active');
    expect(r.body.data.quota_per_day).toBeGreaterThan(0);
    expect(r.body.data.capabilities.length).toBeGreaterThan(0);
    // All headhunter capabilities should be available initially
    for (const c of r.body.data.capabilities) {
      expect(c.available).toBe(true);
    }
  });

  it('marks capabilities as unavailable when quota is exhausted', async () => {
    const { apiKey, userId } = await registerHeadhunter('b@x.com', 'B');

    // Directly set quota_used to quota_per_day to simulate exhausted quota.
    // (Avoids rate limit + minute-window constraints that 40 actual uploads would hit.)
    const db = new DatabaseSync(testDb);
    const user = db.prepare('SELECT quota_per_day FROM users WHERE id = ?').get(userId) as { quota_per_day: number };
    db.prepare('UPDATE users SET quota_used = ? WHERE id = ?').run(user.quota_per_day, userId);
    db.close();

    const r = await request(app).get('/v1/capabilities/me')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.quota_used).toBeGreaterThanOrEqual(r.body.data.quota_per_day);
    // All capabilities with quota_cost > 0 should be unavailable
    const availableWithCost = r.body.data.capabilities.filter((c: any) => c.available && c.quota_cost > 0);
    expect(availableWithCost.length).toBe(0);
  });
});

describe('x-capability-name response header', () => {
  it('every endpoint response includes the capability name', async () => {
    const { apiKey } = await registerHeadhunter('c@x.com', 'C');

    const r = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(r.status).toBe(200);
    expect(r.headers['x-capability-name']).toBe('headhunter.list_candidates');
  });

  it('endpoints without capability declaration do NOT have the header', async () => {
    const r = await request(app).get('/v1/health');
    expect(r.status).toBe(200);
    // /v1/health is not in any capability file → no header
    expect(r.headers['x-capability-name']).toBeUndefined();
  });
});