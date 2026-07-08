import { describe, it, expect } from 'vitest';
import { calculateMatchScore, scoreJobsForCandidate } from '../../../src/main/lib/matching.js';

describe('calculateMatchScore', () => {
  it('returns 100+ for identical skills (with bonuses)', () => {
    const score = calculateMatchScore({
      candidate_skills: ['vue', 'typescript'],
      candidate_expectations: {},
      job_skills: ['vue', 'typescript'],
      job_title_level: 'senior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
    });
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('returns 0 for fully disjoint skills', () => {
    const score = calculateMatchScore({
      candidate_skills: ['vue', 'typescript'],
      candidate_expectations: {},
      job_skills: ['cobol', 'mainframe'],
      job_title_level: 'senior',
      job_industry: 'finance',
      candidate_title_level: 'junior',
    });
    expect(score).toBe(0);
  });

  it('adds bonus for title_level match', () => {
    const base = calculateMatchScore({
      candidate_skills: ['python'],
      candidate_expectations: {},
      job_skills: ['python'],
      job_title_level: 'junior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
    });
    const matched = calculateMatchScore({
      candidate_skills: ['python'],
      candidate_expectations: {},
      job_skills: ['python'],
      job_title_level: 'senior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
    });
    expect(matched).toBeGreaterThan(base);
  });

  it('returns 0-100 range', () => {
    const score = calculateMatchScore({
      candidate_skills: ['vue', 'ts', 'react'],
      candidate_expectations: { expected_salary_min: 100, expected_salary_max: 200 },
      job_skills: ['vue', 'ts'],
      job_title_level: 'senior',
      job_industry: 'tech',
      candidate_title_level: 'senior',
      job_salary_min: 150,
      job_salary_max: 250,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('scoreJobsForCandidate', () => {
  it('ranks jobs by score descending', () => {
    const jobs = [
      { id: 'j1', skills: ['rust', 'wasm'], title_level: 'senior', industry: 'tech', salary_min: 100, salary_max: 200 },
      { id: 'j2', skills: ['vue', 'typescript'], title_level: 'senior', industry: 'tech', salary_min: 100, salary_max: 200 },
      { id: 'j3', skills: ['cobol'], title_level: 'junior', industry: 'finance', salary_min: 50, salary_max: 80 },
    ];
    const scored = scoreJobsForCandidate(
      { skills: ['vue', 'typescript'], expectations: {}, title_level: 'senior' },
      jobs
    );
    expect(scored[0].job_id).toBe('j2');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
    expect(scored[1].job_id).toBe('j1');
    expect(scored[2].job_id).toBe('j3');
  });
});