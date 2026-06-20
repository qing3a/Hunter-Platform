// src/main/modules/view/gather-landing-data.ts
import type { DB } from '../../db/connection.js';

export interface CandidateCard {
  anonymized_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}

export interface IndustryGroup {
  industry: string;
  candidates: CandidateCard[];
}

export interface RecentJob {
  title: string;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  required_skills: string[];
}

export interface HeadhunterRanking {
  rank: number;
  id: string;
  name: string;
  reputation: number;
}

export interface PlacementItem {
  title: string;
  industry: string | null;
  salaryText: string;
  headhunterName: string;
  at: string;
}

export interface EmployerRanking {
  id: string;
  name: string;
  recCount: number;
}

export interface IndustryRanking {
  industry: string;
  candCount: number;
}

export interface SkillCount {
  skill: string;
  count: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface LandingData {
  openJobsCount: number;
  publicCandidatesCount: number;
  industryGroups: IndustryGroup[];
  recentJobs: RecentJob[];
  activeEmployerCount: number;
  activeHeadhunterCount: number;
  serverTime: string;
  todayUnlocks: number;
  todayPlacements: number;
  totalCandidates: number;
  uptimePercent: number;
  topHeadhunters: HeadhunterRanking[];
  latestPlacements: PlacementItem[];
  topEmployers: EmployerRanking[];
  topIndustries: IndustryRanking[];
  hotSkills: SkillCount[];
  healthStatus: HealthStatus;
}

export function gatherLandingData(_db: DB): LandingData {
  throw new Error('not implemented');
}