import { describe, it, expect } from 'vitest';
import {
  RegisterResponseSchema,
  RotateKeyResponseSchema,
} from '../../src/main/schemas/auth';

describe('RegisterResponseSchema', () => {
  it('accepts a valid register response envelope', () => {
    const r = RegisterResponseSchema.safeParse({
      ok: true,
      data: {
        id: 'user_abc',
        api_key: 'hp_live_xyz123',
        quota_per_day: 100,
        user_type: 'candidate',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an api_key without hp_live_ prefix', () => {
    const r = RegisterResponseSchema.safeParse({
      ok: true,
      data: {
        id: 'user_abc',
        api_key: 'hp_test_xyz123',
        quota_per_day: 100,
        user_type: 'candidate',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid user_type', () => {
    const r = RegisterResponseSchema.safeParse({
      ok: true,
      data: {
        id: 'user_abc',
        api_key: 'hp_live_xyz123',
        quota_per_day: 100,
        user_type: 'admin',
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('RotateKeyResponseSchema', () => {
  it('accepts a valid rotate-key response envelope', () => {
    const r = RotateKeyResponseSchema.safeParse({
      ok: true,
      data: {
        new_api_key: 'hp_live_newkey',
        new_prefix: 'hp_live_abcd',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects new_prefix that is not exactly 12 chars', () => {
    const r = RotateKeyResponseSchema.safeParse({
      ok: true,
      data: {
        new_api_key: 'hp_live_newkey',
        new_prefix: 'short',
      },
    });
    expect(r.success).toBe(false);
  });
});