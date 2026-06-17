import type { AnonymizedCandidate } from '../../../shared/types.js';
import { INDUSTRY_MAP, TITLE_LEVEL_PATTERNS, SALARY_BANDS, SCHOOL_TIERS } from './mapping.js';

export interface DesensitizeInput {
  current_company?: string;
  current_title?: string;
  expected_salary?: number;
  years_experience?: number;
  education_school?: string;
  skills?: string[];
}

export function desensitize(input: DesensitizeInput): AnonymizedCandidate {
  return {
    industry: input.current_company ? (INDUSTRY_MAP[input.current_company] ?? '其他') : null,
    title_level: input.current_title ? (matchTitleLevel(input.current_title) ?? '未分类') : null,
    years_experience: input.years_experience ?? null,
    salary_range: input.expected_salary != null ? matchSalaryBand(input.expected_salary) : null,
    education_tier: input.education_school ? (SCHOOL_TIERS[input.education_school] ?? '普通') : null,
    skills: input.skills ?? [],
  };
}

function matchTitleLevel(title: string): string | null {
  for (const { regex, level } of TITLE_LEVEL_PATTERNS) {
    if (regex.test(title)) return level;
  }
  return null;
}

function matchSalaryBand(salary: number): string {
  for (const band of SALARY_BANDS) {
    if (salary >= band.min && (band.max === null || salary < band.max)) return band.label;
  }
  return SALARY_BANDS[SALARY_BANDS.length - 1]!.label;  // 兜底
}
