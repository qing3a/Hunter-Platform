import { describe, it, expect } from 'vitest';
import {
  LeaderboardResponseSchema, JobsListResponseSchema,
} from '../../src/main/schemas/market';
import {
  IndustriesResponseSchema, TitleLevelsResponseSchema, SalaryBandsResponseSchema,
} from '../../src/main/schemas/config';

describe('LeaderboardResponseSchema', () => {
  it('accepts a leaderboard list', () => {
    const r = LeaderboardResponseSchema.safeParse({
      ok: true,
      data: [
        { rank: 1, id: 'user_h1', name: 'Alice', reputation: 100 },
        { rank: 2, id: 'user_h2', name: 'Bob', reputation: 50 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts an empty list', () => {
    const r = LeaderboardResponseSchema.safeParse({ ok: true, data: [] });
    expect(r.success).toBe(true);
  });
});

describe('JobsListResponseSchema', () => {
  it('accepts a list of public jobs', () => {
    const r = JobsListResponseSchema.safeParse({
      ok: true,
      data: [{
        id: 'job_x',
        employer_id: 'user_e1',
        title: 'Engineer',
        description: null,
        required_skills: ['ts'],
        salary_min: 100000,
        salary_max: 200000,
        priority: 'normal',
        industry: 'tech',
        created_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    expect(r.success).toBe(true);
  });
});

describe('IndustriesResponseSchema', () => {
  it('accepts an industries list', () => {
    const r = IndustriesResponseSchema.safeParse({
      ok: true,
      data: [{ id: 'tech', companies_count: 5 }],
    });
    expect(r.success).toBe(true);
  });
});

describe('TitleLevelsResponseSchema', () => {
  it('accepts a title levels list', () => {
    const r = TitleLevelsResponseSchema.safeParse({
      ok: true,
      data: [{ code: 'P6', match: 'P[5-7]' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('SalaryBandsResponseSchema', () => {
  it('accepts a salary bands list', () => {
    const r = SalaryBandsResponseSchema.safeParse({
      ok: true,
      data: [
        { label: '0-30万', min: 0, max: 300000 },
        { label: '30-50万', min: 300000, max: 500000 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts null max for open-ended bands', () => {
    const r = SalaryBandsResponseSchema.safeParse({
      ok: true,
      data: [{ label: '100万+', min: 1000000, max: null }],
    });
    expect(r.success).toBe(true);
  });
});