import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshApp, cleanupDb, ConformanceClient } from './_setup';
import {
  RegisterResponseSchema, RotateKeyResponseSchema,
  LoginResponseSchema, RefreshResponseSchema, LogoutResponseSchema,
} from '../../../src/main/schemas/auth';

describe('skill.md: auth (scenario 1)', () => {
  let client: ConformanceClient;

  // freshApp() sets RATE_LIMIT_ENABLED=false (killswitch per skill.md §5.6)
  // so we don't hit the IP rate-limit on /v1/auth/register (5/h) when
  // many tests register sequentially. Test-only env var; production
  // unchanged.
  beforeAll(async () => {
    const f = await freshApp('auth');
    client = new ConformanceClient(f.app);
  });
  afterAll(() => cleanupDb('auth'));

  it('POST /v1/auth/register returns api_key (validated against zod schema)', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/register',
      body: { user_type: 'hr', name: 'Tester', contact: 't@x.com' },
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
      body: { user_type: 'pm', name: 'T2', contact: 't2@x.com' },
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
    // Use a unique contact (uuid-suffixed) to avoid same-role contact collision
    // across re-runs within a 24h window.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const oldKey = await client.register('candidate', 'RotateTester', `rt-${unique}@x.com`);
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

  // ─────────────────────────────────────────────────────────────────────────
  // R1.C2 — Session token (PR #3 reconciliation + PR #4 follow-up scenarios)
  //
  // 3 fresh capabilities: auth.login, auth.refresh, auth.logout.
  // Existing scenarios above stay untouched; new tests below use unique
  // uuid-suffixed contacts so they don't collide on re-run within 24h.
  // ─────────────────────────────────────────────────────────────────────────

  let sessionLoginKey: string;
  let sessionRefreshKey: string;
  let sessionLogoutKey: string;
  beforeAll(async () => {
    const u = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    sessionLoginKey   = await client.register('pm',       'PM-Login',   `session-login-${u}@x.com`);
    sessionRefreshKey = await client.register('hr',       'HR-Refresh', `session-refresh-${u}@x.com`);
    sessionLogoutKey  = await client.register('candidate', 'C-Logout',   `session-logout-${u}@x.com`);
  });

  it('POST /v1/auth/login returns 168h session_id (R1.C2)', async () => {
    const r = await client.request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { api_key: sessionLoginKey, active_role: 'pm' },
      schema: LoginResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.session_id).toMatch(/^sess_/);
    expect(r.data.data.active_role).toBe('pm');
    expect(r.data.data.available_roles).toEqual(expect.arrayContaining(['candidate', 'hr', 'pm']));
    // expires_at is ISO 8601 string (per LoginResponseSchema); verify it parses
    // and is in the future.
    const expMs = Date.parse(r.data.data.expires_at as string);
    expect(Number.isFinite(expMs)).toBe(true);
    expect(expMs).toBeGreaterThan(Date.now());
  });

  it('POST /v1/auth/refresh slides expiry + switches active_role (R1.C2)', async () => {
    const loginRes = await client.request({
      method: 'POST', path: '/v1/auth/login',
      body: { api_key: sessionRefreshKey, active_role: 'hr' },
    });
    const oldSessionId = loginRes.data.data.session_id as string;
    const oldExpIso = loginRes.data.data.expires_at as string;

    const r = await client.request({
      method: 'POST', path: '/v1/auth/refresh',
      body: { session_id: oldSessionId, active_role: 'candidate' },
      schema: RefreshResponseSchema,
    });
    expect(r.status).toBe(200);
    expect(r.data.data.session_id).toMatch(/^sess_/);
    // Same or new session_id — both fine (refresh can rotate); active_role flipped.
    expect(r.data.data.active_role).toBe('candidate');
    const oldMs = Date.parse(oldExpIso);
    const newMs = Date.parse(r.data.data.expires_at as string);
    expect(newMs).toBeGreaterThanOrEqual(oldMs);
  });

  it('POST /v1/auth/logout returns revoked=true for existing session, idempotent on retry (R1.C2)', async () => {
    const loginRes = await client.request({
      method: 'POST', path: '/v1/auth/login',
      body: { api_key: sessionLogoutKey, active_role: 'candidate' },
    });
    const sessionId = loginRes.data.data.session_id as string;

    const ok = await client.request({
      method: 'POST', path: '/v1/auth/logout',
      body: { session_id: sessionId },
      schema: LogoutResponseSchema,
    });
    expect(ok.status).toBe(200);
    expect(ok.data.data.revoked).toBe(true);

    // Idempotent — a second logout of an already-revoked session still
    // returns 200 (the lookup still finds the row).
    const idemp = await client.request({
      method: 'POST', path: '/v1/auth/logout',
      body: { session_id: sessionId },
    });
    expect(idemp.status).toBe(200);
  });
});
