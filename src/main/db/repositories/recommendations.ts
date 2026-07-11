import type { DB } from '../connection.js';
import type { Recommendation, RecStatus } from '../../../shared/types.js';

export function createRecommendationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO recommendations (id, headhunter_id, employer_id, anonymized_candidate_id, job_id,
                                 status, source_type, pickup_headhunter_id, candidate_note,
                                 commission_split_json, referrer_headhunter_id,
                                 created_at, updated_at)
    VALUES (@id, @headhunter_id, @employer_id, @anonymized_candidate_id, @job_id,
            @status, COALESCE(@source_type, 'hr'),
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

    /**
     * PM Workbench / Task 9 — aggregate counts grouped by pipeline_stage
     * for a single project_position. Returns the per-stage totals plus the
     * un-paginated grand total. Only recommendations with a non-null
     * `position_id` are counted (hunter-side legacy rows are excluded).
     *
     * The aggregation is done in SQL so the handler doesn't have to fetch
     * the whole recommendations table just to count it.
     */
    aggregateByPositionStage(positionId: string): {
      submitted: number;
      screen_passed: number;
      interview: number;
      offer: number;
      onboarded: number;
      rejected: number;
      total: number;
    } {
      const row = db.prepare(`
        SELECT
          SUM(CASE WHEN pipeline_stage = 'submitted'     THEN 1 ELSE 0 END) AS submitted,
          SUM(CASE WHEN pipeline_stage = 'screen_passed' THEN 1 ELSE 0 END) AS screen_passed,
          SUM(CASE WHEN pipeline_stage = 'interview'     THEN 1 ELSE 0 END) AS interview,
          SUM(CASE WHEN pipeline_stage = 'offer'         THEN 1 ELSE 0 END) AS offer,
          SUM(CASE WHEN pipeline_stage = 'onboarded'     THEN 1 ELSE 0 END) AS onboarded,
          SUM(CASE WHEN pipeline_stage = 'rejected'      THEN 1 ELSE 0 END) AS rejected,
          COUNT(*) AS total
        FROM recommendations
        WHERE position_id = ?
      `).get(positionId) as {
        submitted: number | null;
        screen_passed: number | null;
        interview: number | null;
        offer: number | null;
        onboarded: number | null;
        rejected: number | null;
        total: number | null;
      };
      return {
        submitted: row.submitted ?? 0,
        screen_passed: row.screen_passed ?? 0,
        interview: row.interview ?? 0,
        offer: row.offer ?? 0,
        onboarded: row.onboarded ?? 0,
        rejected: row.rejected ?? 0,
        total: row.total ?? 0,
      };
    },

    /**
     * PM Workbench / Task 9 — list the recommendations in a single
     * pipeline_stage for a project_position. Ordered by stage_entered_at
     * ASC (oldest first — sticky candidates float to the top of the
     * expanded list, which is the desired UX for "风险告警").
     *
     * Pagination: limit defaults to 20, offset to 0. The handler can cap
     * limit higher if needed — there's no upper bound enforced here.
     */
    findByPositionAndStage(
      positionId: string,
      stage: 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected',
      opts: { limit?: number; offset?: number } = {},
    ): Recommendation[] {
      const limit = Math.max(opts.limit ?? 20, 1);
      const offset = Math.max(opts.offset ?? 0, 0);
      return db.prepare(
        `SELECT * FROM recommendations
         WHERE position_id = ? AND pipeline_stage = ?
         ORDER BY stage_entered_at ASC, id ASC
         LIMIT ? OFFSET ?`
      ).all(positionId, stage, limit, offset) as unknown as Recommendation[];
    },

    /**
     * PM Workbench / Task 9 — batch lookup of anonymized → private → users
     * profile data for one or more `anonymized_candidate_id`s. Returns one
     * row per anonymized id with the two fields the sandbox needs:
     *   - anonymized_candidate_id  (stable key the handler hydrates against)
     *   - candidate_user_id        (the underlying candidate user, used as
     *                              identity on the wire)
     *   - display_name             (raw, pre-mask; the handler still calls
     *                              maskName() before exposing to the PM)
     *
     * Designed to replace the per-candidate 3-table JOIN that used to live
     * inside `hydrateCandidate`. The old path issued one prepared statement
     * per candidate — 6 stages × 20 candidates = up to 120 round-trips per
     * sandbox request. With this method the handler issues exactly ONE
     * parameterized IN-clause query for the whole page.
     *
     * Returns an empty array when `anonymizedIds` is empty (no SQL
     * executed). IDs that don't resolve to a candidate are simply omitted
     * from the result — the caller should handle missing entries.
     *
     * Input is deduped defensively so a candidate appearing in multiple
     * stages doesn't trigger duplicate placeholders.
     */
    findCandidatePublicProfiles(anonymizedIds: string[]): Array<{
      anonymized_candidate_id: string;
      candidate_user_id: string;
      display_name: string | null;
    }> {
      // Dedup to keep placeholder count minimal; preserve the caller's
      // contract (set semantics) since the join can only produce one row
      // per anonymized id anyway.
      const uniqueIds = Array.from(new Set(anonymizedIds.filter((id) => typeof id === 'string' && id.length > 0)));
      if (uniqueIds.length === 0) return [];
      const placeholders = uniqueIds.map(() => '?').join(',');
      return db.prepare(`
        SELECT ca.id AS anonymized_candidate_id,
               cp.candidate_user_id AS candidate_user_id,
               u.name AS display_name
        FROM candidates_anonymized ca
        JOIN candidates_private cp ON cp.id = ca.source_private_id
        JOIN users u ON u.id = cp.candidate_user_id
        WHERE ca.id IN (${placeholders})
      `).all(...uniqueIds) as Array<{
        anonymized_candidate_id: string;
        candidate_user_id: string;
        display_name: string | null;
      }>;
    },
  };
}
