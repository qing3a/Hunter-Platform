import type { DB } from '../connection.js';
import type { Job, JobStatus } from '../../../shared/types.js';

export function createJobsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO jobs (id, employer_id, title, description, requirements,
                      salary_min, salary_max, status, priority, deadline, industry,
                      created_at, updated_at)
    VALUES (@id, @employer_id, @title, @description, @requirements,
            @salary_min, @salary_max, @status, @priority, @deadline, @industry,
            @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const updateStatusStmt = db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?");

  return {
    insert(job: Job): void {
      // node:sqlite's run() expects a Record<string, SQLInputValue>; cast through
      // unknown to bridge the Job interface (no string index signature) to the
      // expected shape. Safe because the named-param SQL only references the
      // fields actually present in Job.
      insertStmt.run(job as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): Job | undefined {
      return findByIdStmt.get(id) as Job | undefined;
    },
    listByEmployer(employerId: string, opts: { status?: JobStatus; limit?: number; offset?: number } = {}): Job[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM jobs WHERE employer_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(employerId, opts.status, limit, offset) as unknown as Job[];
      }
      return db.prepare(
        'SELECT * FROM jobs WHERE employer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(employerId, limit, offset) as unknown as Job[];
    },
    listPublic(opts: { industry?: string; limit?: number; offset?: number } = {}): Job[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.industry) {
        return db.prepare(
          "SELECT * FROM jobs WHERE status = 'open' AND industry = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).all(opts.industry, limit, offset) as unknown as Job[];
      }
      return db.prepare(
        "SELECT * FROM jobs WHERE status = 'open' ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(limit, offset) as unknown as Job[];
    },
    updateStatus(id: string, status: JobStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
  };
}
