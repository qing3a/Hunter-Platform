import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import { RegisterResponseSchema, RotateKeyResponseSchema } from '../../../src/main/schemas/auth';

describe('skill.md: auth (scenario 1)', () => {
  let client: ConformanceClient;

  beforeAll(async () => {
    const f = await freshApp('auth');
    client = new ConformanceClient(f.app);
  });
  afterAll(() => cleanupDb('auth'));

  it('POST /v1/auth/register returns api_key (validated against zod schema)', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'headhunter', name: 'Tester', contact: 't@x.com' },
      schema: RegisterResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.api_key).toMatch(/^hp_live_/);
    expect(r.data.data.id).toMatch(/^user_/);
  });

  it('POST /v1/auth/register response has x-capability-name=auth.register', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'employer', name: 'T2', contact: 't2@x.com' },
    });
    expect(r.headers['x-capability-name']).toBe('auth.register');
  });

  it('POST /v1/auth/register with invalid user_type returns 400 (negative)', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'alien', name: 'NoContact', contact: 'x@x.com' },
    });
    expect(r.status).toBe(400);
  });

  it('POST /v1/auth/rotate-key returns new key + invalidates old (Bug 1 fix)', async () => {
    const oldKey = await client.register('candidate', 'RotateTester', 'rt@x.com');
    // Rotate
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/rotate-key',
      auth: oldKey,
      schema: RotateKeyResponseSchema,
    });
    expect(r.status).toBe(200);
    const newKey = r.data.data.new_api_key as string;
    expect(newKey).not.toBe(oldKey);
    // Old key must be invalid immediately (no grace period)
    const oldAttempt = await client.request({
      method: 'GET', path: '/v1/users/candidate_user_rt/status', auth: oldKey,
    });
    expect(oldAttempt.status).toBe(401);
  });
});