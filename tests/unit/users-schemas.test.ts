import { describe, it, expect } from 'vitest';
import {
  UserStatusResponseSchema,
  UserHistoryResponseSchema,
} from '../../src/main/schemas/users';

describe('UserStatusResponseSchema', () => {
  it('accepts a complete user status envelope', () => {
    const r = UserStatusResponseSchema.safeParse({
      ok: true,
      data: {
        id: 'user_x',
        user_type: 'candidate',
        name: 'Alice',
        quota_per_day: 100,
        quota_used: 5,
        quota_reset_at: '2026-06-22T00:00:00.000Z',
        reputation: 42,
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid user_type', () => {
    const r = UserStatusResponseSchema.safeParse({
      ok: true,
      data: {
        id: 'user_x',
        user_type: 'admin',
        name: 'Alice',
        quota_per_day: 100,
        quota_used: 5,
        quota_reset_at: '2026-06-22T00:00:00.000Z',
        reputation: 42,
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('UserHistoryResponseSchema', () => {
  it('accepts an empty history list', () => {
    const r = UserHistoryResponseSchema.safeParse({ ok: true, data: [] });
    expect(r.success).toBe(true);
  });

  it('accepts a complete history item', () => {
    const r = UserHistoryResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 1,
        user_id: 'user_x',
        capability_name: 'auth.register',
        target_type: null,
        target_id: null,
        request_summary_json: null,
        error_code: null,
        status: 'success',
        duration_ms: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid action history status', () => {
    const r = UserHistoryResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 1,
        user_id: 'user_x',
        capability_name: 'auth.register',
        target_type: null,
        target_id: null,
        request_summary_json: null,
        error_code: null,
        status: 'unknown',
        duration_ms: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    expect(r.success).toBe(false);
  });
});