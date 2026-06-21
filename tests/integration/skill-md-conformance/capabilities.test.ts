import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import { createRequire } from 'node:module';
import {
  CapabilitiesResponseSchema,
  MeCapabilitiesResponseSchema,
} from '../../../src/main/schemas/capabilities';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

describe('skill.md: capabilities (Phase 4)', () => {
  let client: ConformanceClient;
  let dbPath: string;

  beforeAll(async () => {
    const f = await freshApp('capabilities');
    client = new ConformanceClient(f.app);
    dbPath = f.dbPath;
  });
  afterAll(() => cleanupDb('capabilities'));

  it('GET /v1/capabilities is public (no auth required)', async () => {
    const r = await client.request({
      method: 'GET', path: '/v1/capabilities',
      schema: CapabilitiesResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.sets.length).toBeGreaterThanOrEqual(5);
  });

  it('GET /v1/capabilities lists headhunter, employer, candidate, admin, auth', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/capabilities' });
    const roles = r.data.data.sets.map((s: any) => s.role);
    expect(roles).toEqual(expect.arrayContaining([
      'headhunter', 'employer', 'candidate', 'admin', 'auth',
    ]));
  });

  it('GET /v1/capabilities/me requires auth (negative)', async () => {
    const r = await client.request({ method: 'GET', path: '/v1/capabilities/me' });
    expect(r.status).toBe(401);
  });

  it('GET /v1/capabilities/me returns this user\'s available capabilities', async () => {
    const key = await client.register('headhunter', 'CapTester', 'cap@x.com');
    const r = await client.request({
      method: 'GET', path: '/v1/capabilities/me', auth: key,
      schema: MeCapabilitiesResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.user_type).toBe('headhunter');
    expect(r.data.data.capabilities.length).toBeGreaterThanOrEqual(5);
    // All headhunter caps should be available initially (quota fresh)
    for (const c of r.data.data.capabilities) {
      expect(c.available).toBe(true);
    }
  });

  it('GET /v1/capabilities/me marks caps unavailable when quota exhausted (Phase 4 canInvoke)', async () => {
    const key = await client.register('headhunter', 'QuotaTester', 'qt@x.com');

    // Directly set quota_used = quota_per_day in the DB. upload_candidate
    // requires an existing candidate_user_id and 10 real uploads would
    // hit rate limits; direct DB write is cleaner for the conformance test.
    const regRes = await client.request({
      method: 'GET', path: '/v1/capabilities/me', auth: key,
    });
    const userId = regRes.data.data.user_id;
    const db = new DatabaseSync(dbPath);
    const user = db.prepare('SELECT quota_per_day FROM users WHERE id = ?').get(userId) as { quota_per_day: number };
    db.prepare('UPDATE users SET quota_used = ? WHERE id = ?').run(user.quota_per_day, userId);
    db.close();

    const r = await client.request({
      method: 'GET', path: '/v1/capabilities/me', auth: key,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.quota_used).toBeGreaterThanOrEqual(r.data.data.quota_per_day);
    // All caps with cost > 0 should be unavailable now
    const availableWithCost = r.data.data.capabilities.filter(
      (c: any) => c.available && c.quota_cost > 0
    );
    expect(availableWithCost.length).toBe(0);
  });
});