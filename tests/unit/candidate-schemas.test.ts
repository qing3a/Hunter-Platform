import { describe, it, expect } from 'vitest';
import {
  ListOpportunitiesResponseSchema,
  AccessLogResponseSchema,
  ExportMyDataResponseSchema,
  ApproveUnlockResponseSchema,
  RejectUnlockResponseSchema,
  DeleteMyDataResponseSchema,
} from '../../src/main/schemas/candidate';

const baseOpp = {
  recommendation_id: 'rec_x',
  job_id: 'job_x',
  job_title: 'Engineer',
  job_salary_min: 100000,
  job_salary_max: 200000,
  employer_id: 'user_e1',
  status: 'pending',
  requested_at: '2026-01-01T00:00:00.000Z',
};

const baseAudit = {
  id: 1,
  recommendation_id: 'rec_x',
  actor_user_id: 'user_x',
  action: 'express_interest',
  ip_address: null,
  user_agent: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('ListOpportunitiesResponseSchema', () => {
  it('accepts a list', () => {
    const r = ListOpportunitiesResponseSchema.safeParse({ ok: true, data: [baseOpp] });
    expect(r.success).toBe(true);
  });

  it('accepts an empty list', () => {
    const r = ListOpportunitiesResponseSchema.safeParse({ ok: true, data: [] });
    expect(r.success).toBe(true);
  });
});

describe('AccessLogResponseSchema', () => {
  it('accepts an audit log entry', () => {
    const r = AccessLogResponseSchema.safeParse({ ok: true, data: [baseAudit] });
    expect(r.success).toBe(true);
  });
});

describe('ExportMyDataResponseSchema', () => {
  it('accepts a complete export payload', () => {
    const r = ExportMyDataResponseSchema.safeParse({
      ok: true,
      data: {
        user: {
          id: 'user_x', user_type: 'candidate', name: 'Alice', contact: 'a@a.com',
          agent_endpoint: null, reputation: 10, status: 'active', created_at: '2026-01-01T00:00:00.000Z',
        },
        candidates_private: [],
        candidates_anonymized: [],
        recommendations: [],
        audit_log_entries: [],
        exported_at: '2026-01-01T00:00:00.000Z',
        format_version: '1.0',
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('ApproveUnlockResponseSchema', () => {
  it('accepts candidate_approved status', () => {
    const r = ApproveUnlockResponseSchema.safeParse({ ok: true, data: { status: 'candidate_approved' } });
    expect(r.success).toBe(true);
  });
});

describe('RejectUnlockResponseSchema', () => {
  it('accepts rejected_candidate status', () => {
    const r = RejectUnlockResponseSchema.safeParse({ ok: true, data: { status: 'rejected_candidate' } });
    expect(r.success).toBe(true);
  });
});

describe('DeleteMyDataResponseSchema', () => {
  it('accepts a delete summary', () => {
    const r = DeleteMyDataResponseSchema.safeParse({
      ok: true,
      data: {
        anonymized_rows_preserved: 3,
        recommendations_withdrawn: 5,
        private_pii_rows_cleared: 2,
        deleted_at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(r.success).toBe(true);
  });
});