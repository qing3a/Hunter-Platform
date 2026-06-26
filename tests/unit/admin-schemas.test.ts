import { describe, it, expect } from 'vitest';
import {
  PingResponseSchema, DashboardStatsResponseSchema, ListUsersResponseSchema,
  SuspendUserResponseSchema, UnsuspendUserResponseSchema, AdjustQuotaResponseSchema,
  ListCandidatesResponseSchema, RemoveFromPoolResponseSchema, AuditListResponseSchema,
  DeadLetterListResponseSchema, RetryWebhookResponseSchema,
  RateLimitBucketsResponseSchema, ClearRateLimitResponseSchema,
  ListConfigResponseSchema, GetConfigResponseSchema, AdminPlacementsListResponseSchema,
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
        today_new_users: 2, trend_30d: Array(30).fill(0),
        // Sub-C Plan 1 additions
        today_new_recommendations: 5,
        recommendations_pending: 3,
        recommendations_unlocked: 2,
        jobs_paused: 1,
        jobs_closed: 1,
        jobs_filled: 1,
        total_recommendations: 10,
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
      data: { user_id: 'u1', previous_quota: 100, new_quota: 200, reason: 'test' },
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

describe('ListConfigResponseSchema (Sub-E Config DB-backed)', () => {
  it('accepts a config entry array', () => {
    const r = ListConfigResponseSchema.safeParse({
      ok: true,
      data: [
        { key: 'platform_fee_pct', value: 5, updated_at: '2026-06-26T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
        { key: 'commission', value: { rate: 0.1 }, updated_at: '2026-06-26T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe('GetConfigResponseSchema (Sub-E Config DB-backed)', () => {
  it('accepts a single config entry', () => {
    const r = GetConfigResponseSchema.safeParse({
      ok: true,
      data: { key: 'platform_fee_pct', value: 5, updated_at: '2026-06-26T00:00:00Z', updated_by_admin_user_id: 'adm_1' },
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

// Phase 6: happy-path fixtures for the 3 detached schemas that were
// detached from the table shape until Phase 6 reshaped the handlers.

describe('RateLimitBucketsResponseSchema', () => {
  it('accepts a valid bucket', () => {
    const r = RateLimitBucketsResponseSchema.safeParse({
      ok: true,
      data: [{
        user_id: 'user_1',
        bucket_key: 'user_1:2026-06-22T00:00:00Z',
        count: 5,
        window_started_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(r.success).toBe(true);
  });
});

describe('AdminPlacementsListResponseSchema', () => {
  it('accepts a valid placement', () => {
    const r = AdminPlacementsListResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 'placement_1',
        job_id: 'job_1',
        employer_id: 'employer_1',
        anonymized_candidate_id: 'cand_anon_1',
        primary_headhunter_id: 'h_1',
        referrer_headhunter_id: null,
        annual_salary: 1000000,
        platform_fee: 100000,
        primary_share: 70000,
        referrer_share: 0,
        status: 'pending_payment',
        created_at: '2026-06-22T00:00:00Z',
        updated_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(r.success).toBe(true);
  });
});

describe('AdminLogListResponseSchema', () => {
  it('accepts a valid log entry', () => {
    const r = AdminLogListResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 1,
        actor: 'admin_1',
        action_type: 'suspend_user',
        target_type: 'user',
        target_id: 'user_x',
        reason: 'spam',
        created_at: '2026-06-22T00:00:00Z',
      }],
    });
    expect(r.success).toBe(true);
  });
});