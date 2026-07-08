// src/main/db/repositories/candidate-applications.ts
//
// Repository for the candidate_applications table (v025). One row per
// self-apply; each row is 1:1 with a recommendations row keyed by
// recommendation_id. This file provides CRUD plus two listing helpers:
//   - listByCandidate:   the candidate's own applications (paginated)
//   - listPendingPickup: headhunter pickup queue (open self-apply recs
//                        where no hunter has claimed the application yet)
//
// Note: a recommendation may transition to "pending" (after pickup) while
// the candidate_applications row still has pickup_headhunter_id IS NULL.
// The "list pending pickup" filter therefore joins on
// recommendations.status = 'pending_pickup' rather than the application
// row's pickup_headhunter_id column, so pickup happens in the right order:
//   1. hunter calls the pickup endpoint (this repo's setPickup + the
//      recommendations transition to 'pending' + recs.pickup_headhunter_id
//      is set)
//   2. the row drops off the queue because rec.status is no longer 'pending_pickup'

import type { DB } from '../connection.js';

export interface ApplicationRow {
  id: number;
  recommendation_id: string;
  candidate_user_id: string;
  job_id: string;
  pickup_headhunter_id: string | null;
  candidate_note: string | null;
  withdrawn_at: number | null;
  created_at: number;
}

export interface ApplicationListItem extends ApplicationRow {
  job_title: string | null;
  job_industry: string | null;
  recommendation_status: string;
  source_type: string | null;
  rec_pickup_headhunter_id: string | null;
}

export interface PendingPickupItem extends ApplicationRow {
  job_title: string | null;
  candidate_display_name: string | null;
  recommendation_status: string;
}

export interface ApplicationInsert {
  recommendation_id: string;
  candidate_user_id: string;
  job_id: string;
  candidate_note?: string | null;
}

export function createCandidateApplicationsRepo(db: DB) {
  const insertStmt = db.prepare(`
    INSERT INTO candidate_applications
      (recommendation_id, candidate_user_id, job_id, candidate_note)
    VALUES (?, ?, ?, ?)
  `);
  const findByIdStmt = db.prepare('SELECT * FROM candidate_applications WHERE id = ?');
  const findByRecommendationStmt = db.prepare(
    'SELECT * FROM candidate_applications WHERE recommendation_id = ?',
  );
  const listByCandidateStmt = db.prepare(`
    SELECT
      ca.*,
      j.title        AS job_title,
      j.industry     AS job_industry,
      r.status       AS recommendation_status,
      r.source_type  AS source_type,
      r.pickup_headhunter_id AS rec_pickup_headhunter_id
    FROM candidate_applications ca
    JOIN jobs j ON j.id = ca.job_id
    JOIN recommendations r ON r.id = ca.recommendation_id
    WHERE ca.candidate_user_id = ?
    ORDER BY ca.created_at DESC
    LIMIT ? OFFSET ?
  `);
  const listPendingPickupStmt = db.prepare(`
    SELECT
      ca.*,
      j.title        AS job_title,
      u.name         AS candidate_display_name,
      r.status       AS recommendation_status
    FROM candidate_applications ca
    JOIN jobs j ON j.id = ca.job_id
    JOIN recommendations r ON r.id = ca.recommendation_id
    LEFT JOIN candidates_private cp ON cp.candidate_user_id = ca.candidate_user_id
    LEFT JOIN users u ON u.id = ca.candidate_user_id
    WHERE r.status = 'pending_pickup' AND ca.pickup_headhunter_id IS NULL
    ORDER BY ca.created_at DESC
    LIMIT ? OFFSET ?
  `);
  const setPickupStmt = db.prepare(
    'UPDATE candidate_applications SET pickup_headhunter_id = ? WHERE id = ?',
  );
  const withdrawStmt = db.prepare(
    'UPDATE candidate_applications SET withdrawn_at = ? WHERE id = ?',
  );

  return {
    /**
     * Insert a new application row. Returns the new row id.
     * The companion recommendation row should already exist (caller's
     * responsibility within the same transaction).
     */
    insert(input: ApplicationInsert): number {
      const r = insertStmt.run(
        input.recommendation_id,
        input.candidate_user_id,
        input.job_id,
        input.candidate_note ?? null,
      );
      return Number(r.lastInsertRowid);
    },

    findById(id: number): ApplicationRow | null {
      const row = findByIdStmt.get(id) as ApplicationRow | undefined;
      return row ?? null;
    },

    findByRecommendation(recommendationId: string): ApplicationRow | null {
      const row = findByRecommendationStmt.get(recommendationId) as ApplicationRow | undefined;
      return row ?? null;
    },

    listByCandidate(candidateUserId: string, limit: number, offset: number): ApplicationListItem[] {
      return listByCandidateStmt.all(candidateUserId, limit, offset) as ApplicationListItem[];
    },

    listPendingPickup(limit: number, offset: number): PendingPickupItem[] {
      return listPendingPickupStmt.all(limit, offset) as PendingPickupItem[];
    },

    setPickup(id: number, hunterId: string): void {
      setPickupStmt.run(hunterId, id);
    },

    withdraw(id: number, withdrawnAt: number): void {
      withdrawStmt.run(withdrawnAt, id);
    },
  };
}
