import { describe, it, expect } from 'vitest';
import {
  UploadCandidateResponseSchema,
  RecommendResponseSchema,
  WithdrawResponseSchema,
  PublishResponseSchema,
  ListRecommendationsResponseSchema,
  ListMyCandidatesResponseSchema,
  CreateJobForEmployerResponseSchema,
  ListMyCreatedJobsResponseSchema,
} from '../../src/main/schemas/headhunter';

const baseJob = {
  id: 'job_x',
  employer_id: null,
  source_headhunter_id: 'user_h1',
  created_for_employer_id: null,
  title: 'Senior Engineer',
  description: 'desc',
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

const baseRec = {
  id: 'rec_x',
  headhunter_id: 'user_h1',
  employer_id: 'user_e1',
  anonymized_candidate_id: 'cand_x',
  job_id: 'job_x',
  status: 'pending' as const,
  commission_split_json: null,
  referrer_headhunter_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('UploadCandidateResponseSchema', () => {
  it('accepts a valid upload response', () => {
    const r = UploadCandidateResponseSchema.safeParse({
      ok: true,
      data: {
        anonymized_id: 'cand_x',
        preview: {
          industry: 'tech',
          title_level: 'senior',
          years_experience: 5,
          salary_range: '100k-200k',
          education_tier: 'tier1',
          skills: ['ts'],
        },
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('RecommendResponseSchema', () => {
  it('accepts a valid recommendation', () => {
    const r = RecommendResponseSchema.safeParse({ ok: true, data: baseRec });
    expect(r.success).toBe(true);
  });
});

describe('WithdrawResponseSchema', () => {
  it('accepts withdrawn status', () => {
    const r = WithdrawResponseSchema.safeParse({ ok: true, data: { status: 'withdrawn' } });
    expect(r.success).toBe(true);
  });
});

describe('PublishResponseSchema', () => {
  it('accepts published true', () => {
    const r = PublishResponseSchema.safeParse({ ok: true, data: { published: true } });
    expect(r.success).toBe(true);
  });
});

describe('ListRecommendationsResponseSchema', () => {
  it('accepts a list of recommendations', () => {
    const r = ListRecommendationsResponseSchema.safeParse({ ok: true, data: [baseRec] });
    expect(r.success).toBe(true);
  });

  it('accepts an empty list', () => {
    const r = ListRecommendationsResponseSchema.safeParse({ ok: true, data: [] });
    expect(r.success).toBe(true);
  });
});

describe('ListMyCandidatesResponseSchema', () => {
  it('accepts a candidate entry with extended fields', () => {
    const r = ListMyCandidatesResponseSchema.safeParse({
      ok: true,
      data: [{
        anonymized_id: 'cand_x',
        source_private_id: 'cp_x',
        source_headhunter_id: 'user_h1',
        industry: 'tech',
        title_level: 'senior',
        years_experience: 5,
        salary_range: '100k-200k',
        education_tier: 'tier1',
        skills: ['ts'],
        is_public_pool: 0,
        unlock_status: 'locked',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    expect(r.success).toBe(true);
  });
});

describe('CreateJobForEmployerResponseSchema', () => {
  it('accepts a complete job', () => {
    const r = CreateJobForEmployerResponseSchema.safeParse({ ok: true, data: baseJob });
    expect(r.success).toBe(true);
  });
});

describe('ListMyCreatedJobsResponseSchema', () => {
  it('accepts a list of jobs', () => {
    const r = ListMyCreatedJobsResponseSchema.safeParse({ ok: true, data: [baseJob] });
    expect(r.success).toBe(true);
  });
});