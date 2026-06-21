import type { DB } from '../connection.js';
import type { Job, JobStatus } from '../../../shared/types.js';

export function createJobsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, employer_id, source_headhunter_id, created_for_employer_id,
                      title, description, requirements, required_skills_json,
                      salary_min, salary_max, status, priority, deadline, industry,
                      created_at, updated_at)
    VALUES (@id, @employer_id, @source_headhunter_id, @created_for_employer_id,
            @title, @description, @requirements, @required_skills_json_col,
            @salary_min, @salary_max, @status, @priority, @deadline, @industry,
            @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const updateStatusStmt = db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?");

  /**
   * Hydrate a raw DB row into the Job shape, parsing required_skills_json.
   */
  function hydrate(row: any): Job {
    let required_skills: string[] = [];
    if (row.required_skills_json) {
      try { required_skills = JSON.parse(row.required_skills_json); }
      catch { required_skills = []; }
    }
    return { ...row, required_skills } as Job;
  }

  return {
    insert(job: Job): void {
      const params: Record<string, unknown> = {
        id: job.id,
        employer_id: job.employer_id,
        // v009: 默认 null 兼容旧调用方, 但调用方应该显式提供
        source_headhunter_id: job.source_headhunter_id ?? null,
        created_for_employer_id: job.created_for_employer_id ?? null,
        title: job.title,
        description: job.description,
        requirements: null,
        required_skills_json_col: JSON.stringify(job.required_skills ?? []),
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        status: job.status,
        priority: job.priority,
        deadline: job.deadline,
        industry: job.industry,
        created_at: job.created_at,
        updated_at: job.updated_at,
      };
      insertStmt.run(params as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): Job | undefined {
      const row = findByIdStmt.get(id);
      return row ? hydrate(row) : undefined;
    },
    listByEmployer(employerId: string, opts: { status?: JobStatus; limit?: number; offset?: number } = {}): Job[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      let rows: any[];
      if (opts.status) {
        rows = db.prepare(
          'SELECT * FROM jobs WHERE employer_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(employerId, opts.status, limit, offset) as any[];
      } else {
        rows = db.prepare(
          'SELECT * FROM jobs WHERE employer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(employerId, limit, offset) as any[];
      }
      return rows.map(hydrate);
    },
    listPublic(opts: { industry?: string; limit?: number; offset?: number } = {}): Job[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      // Include both 'open' (unclaimed) and 'claimed' (post-claim, still active)
      // so the public marketplace reflects jobs employers are actively working on.
      // 'paused' / 'closed' / 'filled' are filtered out.
      let rows: any[];
      if (opts.industry) {
        rows = db.prepare(
          `SELECT * FROM jobs
           WHERE status IN ('open','claimed') AND employer_id IS NOT NULL AND industry = ?
           ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(opts.industry, limit, offset) as any[];
      } else {
        rows = db.prepare(
          `SELECT * FROM jobs
           WHERE status IN ('open','claimed') AND employer_id IS NOT NULL
           ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).all(limit, offset) as any[];
      }
      return rows.map(hydrate);
    },
    updateStatus(id: string, status: JobStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
    findPendingClaims(employerId: string): Job[] {
      const rows = db.prepare(
        `SELECT * FROM jobs
         WHERE status = 'open' AND employer_id IS NULL
           AND (created_for_employer_id = ? OR created_for_employer_id IS NULL)
         ORDER BY created_at DESC`
      ).all(employerId) as any[];
      return rows.map(hydrate);
    },
    findBySourceHeadhunter(headhunterId: string): Job[] {
      const rows = db.prepare(
        `SELECT * FROM jobs WHERE source_headhunter_id = ? ORDER BY created_at DESC`
      ).all(headhunterId) as any[];
      return rows.map(hydrate);
    },
    claimByEmployer(jobId: string, employerId: string): Job | undefined {
      // Atomic claim: only update if still unclaimed and open.
      // Status flips from 'open' → 'claimed' so the state machine can guard
      // reject/close transitions and external observers can see ownership change.
      const result = db.prepare(
        `UPDATE jobs
         SET employer_id = ?, status = 'claimed', updated_at = ?
         WHERE id = ? AND status = 'open' AND employer_id IS NULL
           AND (created_for_employer_id = ? OR created_for_employer_id IS NULL)`
      ).run(employerId, new Date().toISOString(), jobId, employerId);
      if (result.changes === 0) return undefined;
      return this.findById(jobId);
    },
  };
}
