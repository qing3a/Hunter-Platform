import type { DB } from '../connection.js';
import type { Recommendation, RecStatus } from '../../../shared/types.js';

export function createRecommendationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id, job_id,
                                 status, commission_split_json, referrer_headhunter_id,
                                 created_at, updated_at)
    VALUES (@id, @headhunter_id, @employer_id, @anonymized_candidate_id, @job_id,
            @status, @commission_split_json, @referrer_headhunter_id,
            @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM recommendations WHERE id = ?');
  const findByCandJobStmt = db.prepare('SELECT * FROM recommendations WHERE anonymized_candidate_id = ? AND job_id = ?');
  const updateStatusStmt = db.prepare("UPDATE recommendations SET status = ?, updated_at = ? WHERE id = ?");

  return {
    insert(rec: Recommendation): void {
      insertStmt.run(rec as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): Recommendation | undefined {
      return findByIdStmt.get(id) as Recommendation | undefined;
    },
    findByCandidateAndJob(anonymizedCandidateId: string, jobId: string): Recommendation | undefined {
      return findByCandJobStmt.get(anonymizedCandidateId, jobId) as Recommendation | undefined;
    },
    updateStatus(id: string, status: RecStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },
    listByHeadhunter(headhunterId: string, opts: { status?: RecStatus; limit?: number; offset?: number } = {}): Recommendation[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM recommendations WHERE headhunter_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(headhunterId, opts.status, limit, offset) as unknown as Recommendation[];
      }
      return db.prepare(
        'SELECT * FROM recommendations WHERE headhunter_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(headhunterId, limit, offset) as unknown as Recommendation[];
    },
    listByEmployer(employerId: string, opts: { status?: RecStatus; limit?: number; offset?: number } = {}): Recommendation[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM recommendations WHERE employer_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(employerId, opts.status, limit, offset) as unknown as Recommendation[];
      }
      return db.prepare(
        'SELECT * FROM recommendations WHERE employer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(employerId, limit, offset) as unknown as Recommendation[];
    },
    listByCandidate(anonymizedCandidateId: string, opts: { status?: RecStatus; limit?: number; offset?: number } = {}): Recommendation[] {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      if (opts.status) {
        return db.prepare(
          'SELECT * FROM recommendations WHERE anonymized_candidate_id = ? AND status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(anonymizedCandidateId, opts.status, limit, offset) as unknown as Recommendation[];
      }
      return db.prepare(
        'SELECT * FROM recommendations WHERE anonymized_candidate_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(anonymizedCandidateId, limit, offset) as unknown as Recommendation[];
    },
  };
}
