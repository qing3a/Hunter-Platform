// tests/integration/capabilities-by-alias.test.ts
//
// Coverage for GET /v1/capabilities/by-alias/:name — the R1.C4 endpoint
// that resolves an external skill name (e.g. ow-recruit's
// `ow_recruit.advance_candidate`) to the internal canonical capability.
// Fulfils the promise documented in docs/superpowers/skill.md §2.1.0.1.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/capabilities-by-alias-test.db');
let app: any;

beforeAll(async () => {
  try { fs.unlinkSync(testDb); } catch {}
  try { fs.unlinkSync(testDb + '-wal'); } catch {}
  try { fs.unlinkSync(testDb + '-shm'); } catch {}
  process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
  process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
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

describe('GET /v1/capabilities/by-alias/:name (R1.C4)', () => {
  it('public — does NOT require auth', async () => {
    // No Authorization header sent.
    const r = await request(app).get('/v1/capabilities/by-alias/ow_recruit.advance_candidate');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('maps ow_recruit.advance_candidate to pm.select_staffing_plan', async () => {
    const r = await request(app).get('/v1/capabilities/by-alias/ow_recruit.advance_candidate');
    expect(r.status).toBe(200);
    expect(r.body.data.canonical).toBe('pm.select_staffing_plan');
    expect(r.body.data.method).toBe('POST');
    expect(r.body.data.path).toBe('/v1/pm/staffing-plans/:id/select');
  });

  it('maps ow_recruit.send_message to candidate_portal.messages.send', async () => {
    const r = await request(app).get('/v1/capabilities/by-alias/ow_recruit.send_message');
    expect(r.status).toBe(200);
    expect(r.body.data.canonical).toBe('candidate_portal.messages.send');
    expect(r.body.data.method).toBe('POST');
    expect(r.body.data.path).toBe('/v1/candidate-portal/messages');
  });

  it('maps ow_recruit.sync_project_to_erp to pm.update_project', async () => {
    const r = await request(app).get('/v1/capabilities/by-alias/ow_recruit.sync_project_to_erp');
    expect(r.status).toBe(200);
    expect(r.body.data.canonical).toBe('pm.update_project');
    expect(r.body.data.method).toBe('PATCH');
    expect(r.body.data.path).toBe('/v1/pm/projects/:id');
  });

  it('resolves by canonical name too (idempotent lookup)', async () => {
    // A canonical name should resolve to itself.
    const r = await request(app).get('/v1/capabilities/by-alias/auth.register');
    expect(r.status).toBe(200);
    expect(r.body.data.canonical).toBe('auth.register');
  });

  it('returns 404 for unknown alias', async () => {
    const r = await request(app).get('/v1/capabilities/by-alias/no.such.alias');
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
});
