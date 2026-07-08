// Candidate Portal: jobs browse/recommended/detail handler
//
// Public-facing methods called from the router layer (Task 12). This module
// only enforces authz (user must be a candidate) and field-level guards;
// the router enforces payload-shape strictness via Zod.
//
// Schema notes (verified against migrations/v002 + v005 + v009):
//   - jobs table has NO `title_level` or `location` columns. We return `null`
//     for those in API responses and pass a default ('mid') to the matching
//     library so the score bonus stays meaningful.
//   - jobs.title is the display name (not `name`).
//   - jobs.required_skills_json is a JSON-encoded TEXT array (added v005).
//   - jobs.industry exists; we expose it directly.
//   - jobs.status default is 'open' — we filter to status='open' for browse.

import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createCandidatePortalProfileRepo } from '../../db/repositories/candidate-portal-profile.js';
import {
  scoreJobsForCandidate,
  calculateMatchScore,
  type JobForRanking,
} from '../../lib/matching.js';
import { Errors } from '../../errors.js';

export interface JobsListFilter {
  industry?: string;
  title_level?: string;
  keyword?: string;
  cursor?: number;
  limit?: number;
}

export interface JobsListResult {
  items: JobListItem[];
  next_cursor: number | null;
}

export interface JobListItem {
  id: string;
  title: string;
  industry: string | null;
  title_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  location: string | null;
  skills: string[];
  priority: string;
  posted_at: string;
  employer_id: string | null;
}

export interface JobsModule {
  browse(user: User, filter?: JobsListFilter): JobsListResult;
  recommended(user: User, opts?: { limit?: number }): { job_id: string; score: number }[];
  detail(user: User, jobId: string): JobDetailView;
}

export interface JobDetailView {
  id: string;
  title: string;
  industry: string | null;
  title_level: string | null;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  location: string | null;
  skills: string[];
  priority: string;
  posted_at: string;
  match_score: number;
  match_dimensions: {
    skills: string[];
    job_skills: string[];
  };
}

/**
 * Helper: safely parse required_skills_json (returns [] when null / malformed).
 */
function parseSkills(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function createCandidatePortalJobs(db: DB): JobsModule {
  const profileRepo = createCandidatePortalProfileRepo(db);

  return {
    /**
     * Browse open jobs. Supports optional filters (industry, title_level,
     * keyword) and cursor-based pagination (default limit 20, max 50).
     * Only candidates may call this — other user types get 403.
     *
     * NOTE: `title_level` is accepted in the filter for forward-compatibility
     * (clients from the design doc may send it), but the jobs table does not
     * have a title_level column. We accept the filter and apply it as a
     * no-op today; a future migration can add the column and a real WHERE
     * clause here.
     */
    browse(user: User, filter: JobsListFilter = {}): JobsListResult {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can browse jobs');
      }

      const where: string[] = ["status = 'open'"];
      const params: (string | number)[] = [];

      if (filter.industry) {
        where.push('industry = ?');
        params.push(filter.industry);
      }
      // title_level accepted but jobs.title_level does not exist in schema
      // — left as a no-op until the column is added.
      void filter.title_level;
      if (filter.keyword) {
        where.push('(title LIKE ? OR description LIKE ? OR requirements LIKE ?)');
        const kw = `%${filter.keyword}%`;
        params.push(kw, kw, kw);
      }

      const limit = Math.min(Math.max(filter.limit ?? 20, 1), 50);
      const offset = Math.max(filter.cursor ?? 0, 0);

      const sql = `
        SELECT id, title, industry, salary_min, salary_max,
               required_skills_json, priority, created_at, employer_id
        FROM jobs
        WHERE ${where.join(' AND ')}
        ORDER BY priority DESC, created_at DESC
        LIMIT ? OFFSET ?
      `;
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params) as Array<{
        id: string;
        title: string;
        industry: string | null;
        salary_min: number | null;
        salary_max: number | null;
        required_skills_json: string | null;
        priority: string;
        created_at: string;
        employer_id: string | null;
      }>;

      const items: JobListItem[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        industry: r.industry,
        title_level: null,
        salary_min: r.salary_min,
        salary_max: r.salary_max,
        location: null,
        skills: parseSkills(r.required_skills_json),
        priority: r.priority,
        posted_at: r.created_at,
        employer_id: r.employer_id,
      }));

      const nextCursor = items.length === limit ? offset + limit : null;
      return { items, next_cursor: nextCursor };
    },

    /**
     * Return up to N jobs ranked by Jaccard + bonus match score (sorted desc).
     * Loads up to 200 most-recent open jobs, scores each, returns top-N.
     * 404 when the candidate hasn't completed onboarding yet (no anon row).
     */
    recommended(
      user: User,
      opts: { limit?: number } = {},
    ): { job_id: string; score: number }[] {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can get recommendations');
      }
      const profile = profileRepo.getProfile(user.id);
      if (!profile) {
        throw Errors.notFound('Profile not found — please complete your profile');
      }

      const jobs = db.prepare(`
        SELECT id, industry, salary_min, salary_max, required_skills_json
        FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT 200
      `).all() as Array<{
        id: string;
        industry: string | null;
        salary_min: number | null;
        salary_max: number | null;
        required_skills_json: string | null;
      }>;

      const jobsForRanking: JobForRanking[] = jobs.map((j) => ({
        id: j.id,
        skills: parseSkills(j.required_skills_json),
        // jobs table has no title_level column — use 'mid' as the match-input
        // default. The Jaccard score (the dominant signal) is unaffected.
        title_level: 'mid',
        industry: j.industry ?? '',
        salary_min: j.salary_min,
        salary_max: j.salary_max,
      }));

      const scored = scoreJobsForCandidate(
        {
          skills: profile.skills,
          expectations: profile.expectations ?? {},
          title_level: profile.title_level ?? 'mid',
        },
        jobsForRanking,
      );

      const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
      return scored.slice(0, limit);
    },

    /**
     * Return full job detail + per-candidate match score and dimensions.
     * match_score is 0 + match_dimensions.skills=[] when the candidate has no
     * profile (so the endpoint is still useful for anonymous browsing without
     * making the matching logic depend on a complete profile).
     */
    detail(user: User, jobId: string): JobDetailView {
      if (user.user_type !== 'candidate') {
        throw Errors.forbidden('Only candidates can view job details');
      }
      const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as
        | {
            id: string;
            title: string;
            industry: string | null;
            description: string | null;
            salary_min: number | null;
            salary_max: number | null;
            required_skills_json: string | null;
            priority: string;
            created_at: string;
          }
        | undefined;
      if (!job) throw Errors.notFound('Job not found');

      const skills = parseSkills(job.required_skills_json);

      const profile = profileRepo.getProfile(user.id);
      let matchScore = 0;
      let matchDimensions: { skills: string[]; job_skills: string[] } = {
        skills: [],
        job_skills: skills,
      };
      if (profile) {
        matchScore = calculateMatchScore({
          candidate_skills: profile.skills,
          candidate_expectations: profile.expectations ?? {},
          job_skills: skills,
          job_title_level: 'mid', // jobs table has no title_level column
          job_industry: job.industry ?? '',
          candidate_title_level: profile.title_level ?? 'mid',
          job_salary_min: job.salary_min,
          job_salary_max: job.salary_max,
        });
        matchDimensions = {
          skills: profile.skills,
          job_skills: skills,
        };
      }

      return {
        id: job.id,
        title: job.title,
        industry: job.industry,
        title_level: null,
        description: job.description,
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        location: null,
        skills,
        priority: job.priority,
        posted_at: job.created_at,
        match_score: matchScore,
        match_dimensions: matchDimensions,
      };
    },
  };
}