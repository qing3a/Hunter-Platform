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

function safeParseSkills(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json) as string[]; } catch { return []; }
}

function formatSalaryAnnual(salary: number | null): string {
  if (salary == null) return '—';
  const wan = salary / 10000;
  if (wan < 50) return `${wan}万`;
  return `${Math.floor(wan / 10) * 10}-${Math.ceil(wan / 10) * 10}万`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function gatherLandingData(db: DB): LandingData {
  // 1) Open jobs count
  const openJobsCount = (db.prepare(
    `SELECT COUNT(*) as c FROM jobs WHERE status = 'open'`
  ).get() as { c: number }).c;

  // 2) Public candidates count
  const publicCandidatesCount = (db.prepare(
    `SELECT COUNT(*) as c FROM candidates_anonymized WHERE is_public_pool = 1`
  ).get() as { c: number }).c;

  // 3) Industry groups (top 5 per industry)
  const candRows = db.prepare(`
    SELECT id, industry, title_level, years_experience, salary_range, education_tier, skills_json
    FROM candidates_anonymized
    WHERE is_public_pool = 1 AND industry IS NOT NULL
    ORDER BY industry, created_at DESC
  `).all() as Array<{
    id: string; industry: string; title_level: string | null;
    years_experience: number | null; salary_range: string | null;
    education_tier: string | null; skills_json: string | null;
  }>;
  const byIndustry = new Map<string, CandidateCard[]>();
  for (const r of candRows) {
    if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
    const list = byIndustry.get(r.industry)!;
    if (list.length < 5) {
      list.push({
        anonymized_id: r.id, industry: r.industry,
        title_level: r.title_level, years_experience: r.years_experience,
        salary_range: r.salary_range, education_tier: r.education_tier,
        skills: safeParseSkills(r.skills_json),
      });
    }
  }
  const industryGroups: IndustryGroup[] = Array.from(byIndustry.entries())
    .map(([industry, candidates]) => ({ industry, candidates }))
    .sort((a, b) => b.candidates.length - a.candidates.length);

  // 4) Recent jobs (top 5)
  const jobRows = db.prepare(`
    SELECT title, industry, salary_min, salary_max, required_skills_json
    FROM jobs WHERE status = 'open'
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    title: string; industry: string | null;
    salary_min: number | null; salary_max: number | null;
    required_skills_json: string | null;
  }>;
  const recentJobs: RecentJob[] = jobRows.map((r) => ({
    title: r.title, industry: r.industry,
    salary_min: r.salary_min, salary_max: r.salary_max,
    required_skills: safeParseSkills(r.required_skills_json),
  }));

  // 5) Active users by type
  const userRows = db.prepare(`
    SELECT user_type, COUNT(*) as c FROM users
    WHERE status = 'active' AND user_type IN ('headhunter', 'employer')
    GROUP BY user_type
  `).all() as Array<{ user_type: string; c: number }>;
  let activeEmployerCount = 0;
  let activeHeadhunterCount = 0;
  for (const r of userRows) {
    if (r.user_type === 'employer') activeEmployerCount = r.c;
    if (r.user_type === 'headhunter') activeHeadhunterCount = r.c;
  }

  // 6) Today unlocks
  const todayUnlocks = (db.prepare(
    `SELECT COUNT(*) as c FROM recommendations
     WHERE status = 'unlocked' AND updated_at >= datetime('now', 'start of day')`
  ).get() as { c: number }).c;

  // 7) Today placements
  const todayPlacements = (db.prepare(
    `SELECT COUNT(*) as c FROM placements
     WHERE updated_at >= datetime('now', 'start of day')`
  ).get() as { c: number }).c;

  // 8) Total candidates
  const totalCandidates = (db.prepare(
    `SELECT COUNT(*) as c FROM candidates_anonymized`
  ).get() as { c: number }).c;

  // 9) Top 3 headhunters
  const topHeadhunterRows = db.prepare(
    `SELECT id, name, reputation FROM users
     WHERE user_type = 'headhunter' AND status = 'active'
     ORDER BY reputation DESC LIMIT 3`
  ).all() as Array<{ id: string; name: string; reputation: number }>;
  const topHeadhunters: HeadhunterRanking[] = topHeadhunterRows.map((r, i) => ({
    rank: i + 1, id: r.id, name: r.name, reputation: r.reputation,
  }));

  // 10) Latest 5 placements
  const placementRows = db.prepare(`
    SELECT p.annual_salary, p.updated_at,
           j.title as job_title, j.industry as job_industry,
           h.name as headhunter_name
    FROM placements p
    LEFT JOIN jobs j ON p.job_id = j.id
    LEFT JOIN users h ON p.primary_headhunter_id = h.id
    WHERE p.status = 'placed'
    ORDER BY p.updated_at DESC LIMIT 5
  `).all() as Array<{
    annual_salary: number | null; updated_at: string;
    job_title: string | null; job_industry: string | null; headhunter_name: string | null;
  }>;
  const latestPlacements: PlacementItem[] = placementRows.map((r) => ({
    title: r.job_title ?? '(已删除岗位)', industry: r.job_industry,
    salaryText: formatSalaryAnnual(r.annual_salary),
    headhunterName: r.headhunter_name ?? '匿名猎头',
    at: relativeTime(r.updated_at),
  }));

  return {
    openJobsCount, publicCandidatesCount, industryGroups, recentJobs,
    activeEmployerCount, activeHeadhunterCount,
    serverTime: new Date().toISOString(),
    todayUnlocks, todayPlacements, totalCandidates,
    uptimePercent: 99.9, topHeadhunters, latestPlacements,
    topEmployers: [], topIndustries: [], hotSkills: [],
    healthStatus: 'healthy',
  };
}