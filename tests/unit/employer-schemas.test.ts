import { describe, it, expect } from 'vitest';
import {
  CreatePlacementResponseSchema,
  ListPlacementsResponseSchema,
  CreateJobResponseSchema,
  ListMyJobsResponseSchema,
  BrowseTalentResponseSchema,
  ExpressInterestResponseSchema,
  UnlockContactResponseSchema,
  PendingClaimsResponseSchema,
  ClaimJobResponseSchema,
  RejectJobResponseSchema,
} from '../../src/main/schemas/employer';

const baseJob = {
  id: 'job_x',
  employer_id: 'user_e1',
  source_headhunter_id: null,
  created_for_employer_id: null,
  title: 'Engineer',
  description: null,
  required_skills: ['ts'],
  salary_min: 100000,
  salary_max: 200000,
  status: 'open' as const,
  priority: 'normal' as const,
  deadline: null,
  industry: 'tech',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const basePlacement = {
  id: 'plc_x',
  job_id: 'job_x',
  candidate_user_id: 'user_c1',
  primary_headhunter_id: 'user_h1',
  referrer_headhunter_id: null,
  anonymized_candidate_id: 'cand_x',
  annual_salary: 200000,
  platform_fee: 20000,
  primary_share: 14000,
  referrer_share: 6000,
  candidate_bonus: 0,
  status: 'pending_payment' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const baseTalent = {
  anonymized_id: 'cand_x',
  industry: 'tech',
  title_level: 'senior',
  years_experience: 5,
  salary_range: null,
  education_tier: 'tier1',
  skills: ['ts'],
};

describe('CreatePlacementResponseSchema', () => {
  it('accepts a valid placement', () => {
    const r = CreatePlacementResponseSchema.safeParse({ ok: true, data: basePlacement });
    expect(r.success).toBe(true);
  });
});

describe('ListPlacementsResponseSchema', () => {
  it('accepts a list', () => {
    const r = ListPlacementsResponseSchema.safeParse({ ok: true, data: [basePlacement] });
    expect(r.success).toBe(true);
  });
});

describe('CreateJobResponseSchema', () => {
  it('accepts a valid job', () => {
    const r = CreateJobResponseSchema.safeParse({ ok: true, data: baseJob });
    expect(r.success).toBe(true);
  });
});

describe('ListMyJobsResponseSchema', () => {
  it('accepts a list', () => {
    const r = ListMyJobsResponseSchema.safeParse({ ok: true, data: [baseJob] });
    expect(r.success).toBe(true);
  });
});

describe('BrowseTalentResponseSchema', () => {
  it('accepts a list of talent previews', () => {
    const r = BrowseTalentResponseSchema.safeParse({ ok: true, data: [baseTalent] });
    expect(r.success).toBe(true);
  });
});

describe('ExpressInterestResponseSchema', () => {
  it('accepts employer_interested status', () => {
    const r = ExpressInterestResponseSchema.safeParse({ ok: true, data: { status: 'employer_interested' } });
    expect(r.success).toBe(true);
  });
});

describe('UnlockContactResponseSchema', () => {
  it('accepts unlocked status', () => {
    const r = UnlockContactResponseSchema.safeParse({ ok: true, data: { status: 'unlocked' } });
    expect(r.success).toBe(true);
  });
});

describe('PendingClaimsResponseSchema', () => {
  it('accepts a list of jobs', () => {
    const r = PendingClaimsResponseSchema.safeParse({ ok: true, data: [baseJob] });
    expect(r.success).toBe(true);
  });
});

describe('ClaimJobResponseSchema', () => {
  it('accepts a claimed job', () => {
    const r = ClaimJobResponseSchema.safeParse({ ok: true, data: baseJob });
    expect(r.success).toBe(true);
  });
});

describe('RejectJobResponseSchema', () => {
  it('accepts closed status', () => {
    const r = RejectJobResponseSchema.safeParse({ ok: true, data: { status: 'closed' } });
    expect(r.success).toBe(true);
  });
});