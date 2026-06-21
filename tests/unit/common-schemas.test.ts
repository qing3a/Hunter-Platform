import { describe, it, expect } from 'vitest';
import {
  ISODateTime,
  IdString,
  OkResponse,
  StatusResponse,
  ErrorEnvelope,
  UserPublicSchema,
} from '../../src/main/schemas/common';

describe('ISODateTime', () => {
  it('accepts a valid ISO 8601 string', () => {
    expect(ISODateTime.safeParse('2026-06-21T10:30:00.000Z').success).toBe(true);
  });

  it('rejects a non-ISO string', () => {
    expect(ISODateTime.safeParse('not-a-date').success).toBe(false);
  });
});

describe('IdString', () => {
  it('accepts a non-empty short id', () => {
    expect(IdString.safeParse('user_abc123').success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(IdString.safeParse('').success).toBe(false);
  });
});

describe('OkResponse', () => {
  it('accepts { ok: true }', () => {
    expect(OkResponse.safeParse({ ok: true }).success).toBe(true);
  });

  it('rejects { ok: false }', () => {
    expect(OkResponse.safeParse({ ok: false }).success).toBe(false);
  });
});

describe('StatusResponse', () => {
  it('accepts a status string', () => {
    expect(StatusResponse.safeParse({ status: 'active' }).success).toBe(true);
  });
});

describe('ErrorEnvelope', () => {
  it('accepts a complete error envelope', () => {
    const r = ErrorEnvelope.safeParse({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'oops', details: { field: 'x' } },
    });
    expect(r.success).toBe(true);
  });

  it('accepts an error envelope without details', () => {
    const r = ErrorEnvelope.safeParse({
      ok: false,
      error: { code: 'X', message: 'y' },
    });
    expect(r.success).toBe(true);
  });
});

describe('UserPublicSchema', () => {
  it('accepts a complete public user', () => {
    const r = UserPublicSchema.safeParse({
      id: 'user_x',
      user_type: 'candidate',
      name: 'Alice',
      quota_per_day: 100,
      quota_used: 5,
      quota_reset_at: '2026-06-22T00:00:00.000Z',
      reputation: 42,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid user_type', () => {
    const r = UserPublicSchema.safeParse({
      id: 'user_x',
      user_type: 'admin',
      name: 'Alice',
      quota_per_day: 100,
      quota_used: 5,
      quota_reset_at: '2026-06-22T00:00:00.000Z',
      reputation: 42,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });
});