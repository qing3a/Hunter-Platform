import { describe, it, expect } from 'vitest';
import {
  PingResponseSchema, DashboardStatsResponseSchema, ListUsersResponseSchema,
  SuspendUserResponseSchema, UnsuspendUserResponseSchema, AdjustQuotaResponseSchema,
  ListCandidatesResponseSchema, RemoveFromPoolResponseSchema, AuditListResponseSchema,
  DeadLetterListResponseSchema, RetryWebhookResponseSchema,
  RateLimitBucketsResponseSchema, ClearRateLimitResponseSchema,
  ConfigGetResponseSchema, ConfigPutResponseSchema, AdminPlacementsListResponseSchema,
  MarkPaidResponseSchema, CancelPlacementResponseSchema,
  PlacementsSummaryResponseSchema, AdminLogListResponseSchema,
} from '../../src/main/schemas/admin';

describe('PingResponseSchema', () => {
  it('accepts pong', () => {
    const r = PingResponseSchema.safeParse({ ok: true, data: { message: 'admin pong' } });
    expect(r.success).toBe(true);
  });
});

describe('DashboardStatsResponseSchema', () => {
  it('accepts a stats payload', () => {
    const r = DashboardStatsResponseSchema.safeParse({
      ok: true,
      data: {
        total_users: 10, total_candidates: 5, total_jobs: 3, open_jobs: 2,
        active_placements: 1, daily_quota_used: 100, webhook_dead_letters: 0,
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('SuspendUserResponseSchema', () => {
  it('accepts a suspended result', () => {
    const r = SuspendUserResponseSchema.safeParse({
      ok: true,
      data: { user_id: 'u1', status: 'suspended', reason: 'spam' },
    });
    expect(r.success).toBe(true);
  });
});

describe('UnsuspendUserResponseSchema', () => {
  it('accepts an active result', () => {
    const r = UnsuspendUserResponseSchema.safeParse({
      ok: true,
      data: { user_id: 'u1', status: 'active' },
    });
    expect(r.success).toBe(true);
  });
});

describe('AdjustQuotaResponseSchema', () => {
  it('accepts an adjusted result', () => {
    const r = AdjustQuotaResponseSchema.safeParse({
      ok: true,
      data: { user_id: 'u1', new_quota: 200 },
    });
    expect(r.success).toBe(true);
  });
});

describe('RemoveFromPoolResponseSchema', () => {
  it('accepts removed result', () => {
    const r = RemoveFromPoolResponseSchema.safeParse({
      ok: true, data: { anonymized_id: 'cand_x', removed: true },
    });
    expect(r.success).toBe(true);
  });
});

describe('RetryWebhookResponseSchema', () => {
  it('accepts pending', () => {
    const r = RetryWebhookResponseSchema.safeParse({
      ok: true, data: { id: 1, status: 'pending' },
    });
    expect(r.success).toBe(true);
  });
});

describe('ClearRateLimitResponseSchema', () => {
  it('accepts cleared result', () => {
    const r = ClearRateLimitResponseSchema.safeParse({
      ok: true, data: { user_id: 'u1', cleared: true },
    });
    expect(r.success).toBe(true);
  });
});

describe('ConfigGetResponseSchema', () => {
  it('accepts a config map', () => {
    const r = ConfigGetResponseSchema.safeParse({
      ok: true,
      data: { desensitization: {}, commission: {} },
    });
    expect(r.success).toBe(true);
  });
});

describe('MarkPaidResponseSchema', () => {
  it('accepts paid status', () => {
    const r = MarkPaidResponseSchema.safeParse({
      ok: true, data: { id: 'pl_x', status: 'paid' },
    });
    expect(r.success).toBe(true);
  });
});

describe('CancelPlacementResponseSchema', () => {
  it('accepts cancelled status', () => {
    const r = CancelPlacementResponseSchema.safeParse({
      ok: true, data: { id: 'pl_x', status: 'cancelled' },
    });
    expect(r.success).toBe(true);
  });
});

describe('PlacementsSummaryResponseSchema', () => {
  it('accepts a summary', () => {
    const r = PlacementsSummaryResponseSchema.safeParse({
      ok: true,
      data: {
        total_count: 10, pending_payment_count: 5, paid_count: 4, cancelled_count: 1,
        total_revenue: 100000,
      },
    });
    expect(r.success).toBe(true);
  });
});