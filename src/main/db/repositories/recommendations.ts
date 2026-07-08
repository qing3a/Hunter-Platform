import type { DB } from '../connection.js';
import type { Recommendation, RecStatus } from '../../../shared/types.js';

export function createRecommendationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id, job_id,
                                 status, source_type, pickup_headhunter_id, candidate_note,
                                 commission_split_json, referrer_headhunter_id,
                                 created_at, updated_at)
    VALUES (@id, @headhunter_id, @employer_id, @anonymized_candidate_id, @job_id,
            @status, COALESCE(@source_type, 'headhunter'),
            @pickup_headhunter_id, @candidate_note,
            @commission_split_json, @referrer_headhunter_id,
            @created_at, @updated_at)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM recommendations WHERE id = ?');
  const findByCandJobStmt = db.prepare('SELECT * FROM recommendations WHERE anonymized_candidate_id = ? AND job_id = ?');
  const updateStatusStmt = db.prepare("UPDATE recommendations SET status = ?, updated_at = ? WHERE id = ?");
  const setPickupHeadhunterStmt = db.prepare(
    "UPDATE recommendations SET pickup_headhunter_id = ?, updated_at = ? WHERE id = ?",
  );
  /**
   * Find an active (non-terminal) recommendation for a candidate user + job pair.
   * "Active" = status is in pending_pickup / pending / employer_interested /
   * considering_offer / candidate_approved / unlocked. Withdrawn, rejected, and
   * placed are excluded so the candidate can re-apply after a clean close.
   *
   * Joins through candidates_anonymized + candidates_private to map the
   * candidate's user_id to their anonymized record.
   */
  const findActiveByCandidateUserAndJobStmt = db.prepare(`
    SELECT r.*
    FROM recommendations r
    JOIN candidates_anonymized ca ON ca.id = r.anonymized_candidate_id
    JOIN candidates_private cp    ON cp.id = ca.source_private_id
    WHERE cp.candidate_user_id = ?
      AND r.job_id = ?
      AND r.status IN (
        'pending_pickup',
        'pending',
        'employer_interested',
        'considering_offer',
        'candidate_approved',
        'unlocked'
      )
    LIMIT 1
  `);

  return {
    insert(rec: Recommendation & {
      source_type?: string | null;
      pickup_headhunter_id?: string | null;
      candidate_note?: string | null;
    }): void {
      insertStmt.run(rec as unknown as Record<string, import('node:sqlite').SQLInputValue>);
    },
    findById(id: string): Recommendation | undefined {
      return findByIdStmt.get(id) as Recommendation | undefined;
    },
    findByCandidateAndJob(anonymizedCandidateId: string, jobId: string): Recommendation | undefined {
      return findByCandJobStmt.get(anonymizedCandidateId, jobId) as Recommendation | undefined;
    },

    /**
     * Lookup by CANDIDATE USER ID + job. Returns the active rec (if any) for
     * a candidate who is mid-flow. Used by the apply endpoint to enforce the
     * "no duplicate active applications" rule.
     */
    findActiveByCandidateAndJob(candidateUserId: string, jobId: string): Recommendation | undefined {
      return findActiveByCandidateUserAndJobStmt.get(candidateUserId, jobId) as Recommendation | undefined;
    },
    updateStatus(id: string, status: RecStatus): void {
      updateStatusStmt.run(status, new Date().toISOString(), id);
    },

    /**
     * Set the pickup_headhunter_id on a recommendation (e.g. when a headhunter
     * claims a self-applied candidate's application).
     */
    setPickupHeadhunter(id: string, hunterId: string): void {
      setPickupHeadhunterStmt.run(hunterId, new Date().toISOString(), id);
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
