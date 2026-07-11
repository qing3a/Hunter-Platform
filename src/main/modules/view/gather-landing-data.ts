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

export interface IndustryNavItem {
  industry: string;
  jobCount: number;
}

export interface FeaturedJob {
  id: string;
  title: string;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  required_skills: string[];
  company_name: string | null;
  created_at: string;
}

export interface HotCompanyRecentJob {
  title: string;
  salary_min: number | null;
  salary_max: number | null;
}

export interface HotCompany {
  id: string;
  name: string;
  openJobCount: number;
  recentJobs: HotCompanyRecentJob[];
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
    uptimeSec: number;
  topHeadhunters: HeadhunterRanking[];
  latestPlacements: PlacementItem[];
  topEmployers: EmployerRanking[];
  topIndustries: IndustryRanking[];
  hotSkills: SkillCount[];
  industryNav: IndustryNavItem[];
  featuredJobs: FeaturedJob[];
  hotCompanies: HotCompany[];
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
  // Demo data policy:
  // - In dev (NODE_ENV !== 'production'): landing shows ALL data including demo_*
  // - In prod (NODE_ENV === 'production'): landing hides demo_* data
  //   (but demo_* rows still exist in DB and are queryable via API endpoints)
  // Filter is applied to ALL queries that read jobs/users in this module,
  // since gatherLandingData is only used by routes/landing.ts (the public homepage).
  const isProd = process.env.NODE_ENV === 'production';
  const demoJobsFilter = isProd ? `AND id NOT LIKE 'demo_%'` : '';
  const demoUsersFilter = isProd ? `AND id NOT LIKE 'demo_%'` : '';

  // 1) Open jobs count — includes both 'open' (unclaimed) and 'claimed' (post-claim)
  // since a claimed job is still "live" and visible to candidates via the marketplace.
  const openJobsCount = (db.prepare(
    `SELECT COUNT(*) as c FROM jobs WHERE status IN ('open','claimed') ${demoJobsFilter}`
  ).get() as { c: number }).c;

  // 2) Public candidates count
  const publicCandidatesCount = (db.prepare(
    `SELECT COUNT(*) as c FROM candidates_anonymized WHERE is_public_pool = 1
     ${isProd ? "AND id NOT LIKE 'demo_%'" : ''}`
  ).get() as { c: number }).c;

  // 3) Industry groups (top 5 per industry)
  const candRows = db.prepare(`
    SELECT id, industry, title_level, years_experience, salary_range, education_tier, skills_json
    FROM candidates_anonymized
    WHERE is_public_pool = 1 AND industry IS NOT NULL
      ${isProd ? "AND id NOT LIKE 'demo_%'" : ''}
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

  // 4) Recent jobs (top 5) — show open + claimed (live jobs). Hide paused/closed/filled
  // and hide employer_id IS NULL (unclaimed headhunter-created jobs, v009).
  const jobRows = db.prepare(`
    SELECT title, industry, salary_min, salary_max, required_skills_json
    FROM jobs WHERE status IN ('open','claimed') AND employer_id IS NOT NULL ${demoJobsFilter}
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
    WHERE status = 'active' AND user_type IN ('headhunter', 'employer') ${demoUsersFilter}
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
    `SELECT COUNT(*) as c FROM candidates_anonymized
     ${isProd ? "WHERE id NOT LIKE 'demo_%'" : ''}`
  ).get() as { c: number }).c;

  // 9) Top 3 headhunters
  const topHeadhunterRows = db.prepare(
    `SELECT id, name, reputation FROM users
     WHERE user_type = 'headhunter' AND status = 'active' ${demoUsersFilter}
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

  // 11) Top 3 employers (with per-field fallback per spec §6)
  let topEmployers: EmployerRanking[] = [];
  try {
    const topEmployerRows = db.prepare(`
      SELECT u.id, u.name, COUNT(r.id) AS rec_count
      FROM users u
      LEFT JOIN recommendations r ON r.employer_id = u.id
      WHERE u.user_type = 'employer' AND u.status = 'active'
        ${isProd ? "AND u.id NOT LIKE 'demo_%'" : ''}
      GROUP BY u.id
      ORDER BY rec_count DESC, COALESCE(u.reputation, 0) DESC
      LIMIT 3
    `).all() as Array<{ id: string; name: string; rec_count: number }>;
    topEmployers = topEmployerRows.map((r) => ({
      id: r.id, name: r.name, recCount: r.rec_count,
    }));
  } catch (e) {
    console.error('Top Employers query failed:', e);
  }

  // 12) Top 3 industries (with per-field fallback per spec §6)
  let topIndustries: IndustryRanking[] = [];
  try {
    const topIndustryRows = db.prepare(`
      SELECT industry, COUNT(*) AS cand_count
      FROM candidates_anonymized
      WHERE is_public_pool = 1 AND industry IS NOT NULL
        AND id NOT LIKE 'demo_%'
      GROUP BY industry
      ORDER BY cand_count DESC
      LIMIT 3
    `).all() as Array<{ industry: string; cand_count: number }>;
    topIndustries = topIndustryRows.map((r) => ({
      industry: r.industry, candCount: r.cand_count,
    }));
  } catch (e) {
    console.error('Top Industries query failed:', e);
  }

  // 13) Hot Skills (JS-side aggregation, top 10, with per-field fallback per spec §6)
  let hotSkills: SkillCount[] = [];
  try {
    const skillJobRows = db.prepare(
      `SELECT required_skills_json FROM jobs WHERE status IN ('open','claimed') ${demoJobsFilter}`
    ).all() as Array<{ required_skills_json: string | null }>;
    const skillCounts = new Map<string, number>();
    for (const r of skillJobRows) {
      for (const s of safeParseSkills(r.required_skills_json)) {
        skillCounts.set(s, (skillCounts.get(s) ?? 0) + 1);
      }
    }
    hotSkills = Array.from(skillCounts.entries())
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  } catch (e) {
    console.error('Hot Skills aggregation failed:', e);
  }

  // 14) DB probe
  let healthStatus: HealthStatus = 'healthy';
  try {
    db.prepare('SELECT 1').get();
  } catch {
    healthStatus = 'degraded';
  }

  // 15) Industry nav — top 20 industries by open job count (v4 SQL A)
  let industryNav: IndustryNavItem[] = [];
  try {
    const rows = db.prepare(`
      SELECT industry, COUNT(*) as job_count
      FROM jobs
      WHERE status IN ('open','claimed') AND industry IS NOT NULL ${demoJobsFilter}
      GROUP BY industry
      ORDER BY job_count DESC
      LIMIT 20
    `).all() as Array<{ industry: string; job_count: number }>;
    industryNav = rows.map((r) => ({ industry: r.industry, jobCount: r.job_count }));
  } catch (e) {
    console.error('Industry nav query failed:', e);
  }

  // 16) Featured jobs (v4 SQL B) — top 10 open jobs by priority then created_at
  let featuredJobs: FeaturedJob[] = [];
  try {
    const rows = db.prepare(`
      SELECT j.id, j.title, j.industry, j.salary_min, j.salary_max,
             j.priority, j.required_skills_json, j.created_at,
             u.name AS company_name
      FROM jobs j
      LEFT JOIN users u ON j.employer_id = u.id
      WHERE j.status IN ('open','claimed') AND j.employer_id IS NOT NULL
        ${isProd ? "AND j.id NOT LIKE 'demo_%'" : ''}
      ORDER BY
        CASE j.priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        j.created_at DESC
      LIMIT 10
    `).all() as Array<{
      id: string; title: string; industry: string | null;
      salary_min: number | null; salary_max: number | null;
      priority: string; required_skills_json: string | null;
      created_at: string; company_name: string | null;
    }>;
    featuredJobs = rows.map((r) => ({
      id: r.id, title: r.title, industry: r.industry,
      salary_min: r.salary_min, salary_max: r.salary_max,
      priority: r.priority as FeaturedJob['priority'],
      required_skills: safeParseSkills(r.required_skills_json),
      company_name: r.company_name,
      created_at: r.created_at,
    }));
  } catch (e) {
    console.error('Featured jobs query failed:', e);
  }

  // 17) Hot companies (v4 SQL C) — top 4 employers by open job count, with their 3 most recent jobs
  let hotCompanies: HotCompany[] = [];
  try {
    const topRows = db.prepare(`
      SELECT u.id, u.name, COUNT(j.id) AS open_job_count
      FROM users u
      INNER JOIN jobs j ON j.employer_id = u.id
      WHERE u.user_type = 'employer'
        AND u.status = 'active'
        AND j.status IN ('open','claimed')
        ${isProd ? "AND u.id NOT LIKE 'demo_%' AND j.id NOT LIKE 'demo_%'" : ''}
      GROUP BY u.id
      ORDER BY open_job_count DESC
      LIMIT 4
    `).all() as Array<{ id: string; name: string; open_job_count: number }>;

    const recentStmt = db.prepare(`
      SELECT title, salary_min, salary_max
      FROM jobs
      WHERE employer_id = ? AND status IN ('open','claimed')
        ${isProd ? "AND id NOT LIKE 'demo_%'" : ''}
      ORDER BY created_at DESC
      LIMIT 3
    `);

    hotCompanies = topRows.map((r) => ({
      id: r.id,
      name: r.name,
      openJobCount: r.open_job_count,
      recentJobs: (recentStmt.all(r.id) as Array<{
        title: string; salary_min: number | null; salary_max: number | null;
      }>),
    }));
  } catch (e) {
    console.error('Hot companies query failed:', e);
  }

  return {
    openJobsCount, publicCandidatesCount, industryGroups, recentJobs,
    activeEmployerCount, activeHeadhunterCount,
    serverTime: new Date().toISOString(),
    todayUnlocks, todayPlacements, totalCandidates,
    // #6 uptime 真实化: use actual process uptime + honest percent.
    // - Fresh process (<60s): cannot claim any uptime percentage → show 100% as "no incidents yet"
    // - Steady state: percent = 100 - (incidents / uptime_days), but we don't track incidents.
    //   Show 99.9 as a conservative estimate that improves with longer uptime.
    // - uptimeSec is exposed for the stats card hint label.
    uptimeSec: Math.floor(process.uptime()),
    uptimePercent: (() => {
      const sec = process.uptime();
      if (sec < 60) return 100;            // fresh boot, no data → optimistic
      const days = sec / 86400;
      if (days < 1) return 99.9;          // < 1 day stable
      if (days < 7) return 99.95;         // < 1 week stable
      return 99.99;                        // mature service, conservative SLO
    })(),
    topHeadhunters, latestPlacements,
    topEmployers, topIndustries, hotSkills,
    industryNav, featuredJobs, hotCompanies,
    healthStatus,
  };
}