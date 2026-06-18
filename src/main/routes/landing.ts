import { Router, type Request, type Response } from 'express';
import type { DB } from '../db/connection.js';
import { renderLanding, type CandidateCard, type IndustryGroup, type RecentJob, type LandingData } from '../modules/view/templates/landing.js';

export function createLandingRouter(db: DB): Router {
  const router = Router();

  // GET / — public marketplace landing page (no auth, no quota)
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = gatherLandingData(db);
      const html = renderLanding(data);
      res.status(200).type('text/html; charset=utf-8').send(html);
    } catch (e) {
      console.error('Landing render failed:', e);
      const fallback = `<!DOCTYPE html><html lang="zh-CN"><body><main><h1>Hunter Platform</h1><p>暂不可用</p></main></body></html>`;
      res.status(500).type('text/html; charset=utf-8').send(fallback);
    }
  });

  return router;
}

function gatherLandingData(db: DB): LandingData {
  const openJobsRow = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'open'`).get() as { c: number };

  const pubCandRow = db.prepare(`SELECT COUNT(*) as c FROM candidates_anonymized WHERE is_public_pool = 1`).get() as { c: number };

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
        anonymized_id: r.id,
        industry: r.industry,
        title_level: r.title_level,
        years_experience: r.years_experience,
        salary_range: r.salary_range,
        education_tier: r.education_tier,
        skills: r.skills_json ? safeParseSkills(r.skills_json) : [],
      });
    }
  }
  const industryGroups: IndustryGroup[] = Array.from(byIndustry.entries())
    .map(([industry, candidates]) => ({ industry, candidates }))
    .sort((a, b) => b.candidates.length - a.candidates.length);

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
    title: r.title,
    industry: r.industry,
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    required_skills: r.required_skills_json ? safeParseSkills(r.required_skills_json) : [],
  }));

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

  return {
    openJobsCount: openJobsRow.c,
    publicCandidatesCount: pubCandRow.c,
    industryGroups,
    recentJobs,
    activeEmployerCount,
    activeHeadhunterCount,
    serverTime: new Date().toISOString(),
  };
}

function safeParseSkills(json: string): string[] {
  try { return JSON.parse(json) as string[]; } catch { return []; }
}