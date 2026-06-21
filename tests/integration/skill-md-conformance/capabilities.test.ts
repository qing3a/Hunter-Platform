import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient, z_ } from './_setup';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

// Inline zod schemas — mirrors src/main/routes/capabilities.ts. Constraint
// #1 forbids touching src/, so we re-declare here. If src/main/schemas/capabilities.ts
// ever exists, replace with import.
const EnvelopeSchema = <T extends z_.ZodTypeAny>(inner: T) =>
  z_.object({ ok: z_.literal(true), data: inner });

const CapabilitiesResponseSchema = EnvelopeSchema(z_.object({
  sets: z_.array(z_.object({
    role: z_.string(),
    capabilities: z_.array(z_.object({
      name: z_.string(),
      description: z_.string(),
      method: z_.enum(['GET', 'POST', 'PUT', 'DELETE']),
      path: z_.string(),
      quota_cost: z_.number().int(),
      preconditions: z_.array(z_.string()),
      effects: z_.array(z_.string()),
    })),
  })),
}));

const MeCapabilitiesResponseSchema = EnvelopeSchema(z_.object({
  user_id: z_.string(),
  user_type: z_.string(),
  status: z_.string(),
  quota_per_day: z_.number().int(),
  quota_used: z_.number().int(),
  quota_remaining: z_.number().int(),
  capabilities: z_.array(z_.object({
    name: z_.string(),
    description: z_.string(),
    method: z_.string(),
    path: z_.string(),
    quota_cost: z_.number().int(),
    available: z_.boolean(),
    reason: z_.string().optional(),
  })),
}));

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