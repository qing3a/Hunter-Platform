import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import { createPlacementsRepo, type Placement } from '../../db/repositories/placements.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createAdminActionLogRepo } from '../../db/repositories/admin-action-log.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { calculateCommission } from './calculator.js';
import { Errors } from '../../errors.js';
import type { User } from '../../../shared/types.js';

export interface CreatePlacementInput {
  anonymized_candidate_id: string;
  job_id: string;
  annual_salary: number;
}

export function createCommissionHandler(db: DB) {
  const places = createPlacementsRepo(db);
  const recs = createRecommendationsRepo(db);
  const jobs = createJobsRepo(db);
  const adminLog = createAdminActionLogRepo(db);

  function findCandidateUserId(anonymizedId: string): string {
    // candidates_anonymized has source_private_id (FK to candidates_private.candidate_user_id)
    const row = db.prepare(
      `SELECT p.candidate_user_id FROM candidates_anonymized a
       JOIN candidates_private p ON p.id = a.source_private_id
       WHERE a.id = ?`
    ).get(anonymizedId) as { candidate_user_id: string } | undefined;
    if (!row) throw Errors.notFound('Anonymized candidate not found');
    return row.candidate_user_id;
  }

  return {
    createPlacement(employer: User, input: CreatePlacementInput): Placement {
      if (employer.user_type !== 'employer') throw Errors.forbidden('Only employers can create placements');

      const rec = recs.findByCandidateAndJob(input.anonymized_candidate_id, input.job_id);
      if (!rec) throw Errors.notFound('No recommendation for this candidate + job');
      if (rec.employer_id !== employer.id) throw Errors.forbidden('Not your recommendation');
      if (rec.status !== 'unlocked') throw Errors.invalidState(`Invalid state: recommendation status is ${rec.status}, must be 'unlocked'`);

      const job = jobs.findById(input.job_id);
      if (!job || job.employer_id !== employer.id) throw Errors.forbidden('Not your job');

      const commission = calculateCommission({
        annual_salary: input.annual_salary,
        referrer_headhunter_id: rec.referrer_headhunter_id,
      });

      const now = new Date().toISOString();
      const placement: Placement = {
        id: `pl_${randomUUID().slice(0, 12)}`,
        job_id: input.job_id,
        candidate_user_id: findCandidateUserId(input.anonymized_candidate_id),
        primary_headhunter_id: rec.headhunter_id,
        referrer_headhunter_id: rec.referrer_headhunter_id,
        anonymized_candidate_id: input.anonymized_candidate_id,
        annual_salary: input.annual_salary,
        platform_fee: commission.platform_fee,
        primary_share: commission.primary_share,
        referrer_share: commission.referrer_share,
        candidate_bonus: 0,
        status: 'pending_payment',
        created_at: now,
        updated_at: now,
      };
      // P1#4: 把 UNIQUE 约束错误包装成 DUPLICATE_REQUEST（不暴露 SQLite 内部）
      try {
        places.insert(placement);
      } catch (e: any) {
        if (e?.message?.includes('UNIQUE constraint failed')) {
          throw Errors.duplicateRequest('Placement already exists for this candidate + job + headhunter');
        }
        throw e;
      }
      return placement;
    },

    markPaid(adminUserId: string, placementId: string): Placement {
      const p = places.findById(placementId);
      if (!p) throw Errors.notFound('Placement not found');
      if (p.status !== 'pending_payment') {
        throw Errors.invalidState(`Invalid state: cannot mark paid, current status is ${p.status}`);
      }
      places.updateStatus(placementId, 'paid');
      adminLog.insert({
        admin_user_id: adminUserId,
        action: 'mark_paid',
        target_type: 'placement',
        target_id: placementId,
        details_json: JSON.stringify({ amount: p.primary_share + p.referrer_share }),
      });
      return places.findById(placementId)!;
    },

    listPlacements(employer: User, opts: { status?: 'pending_payment' | 'paid' | 'cancelled' } = {}): Placement[] {
      if (employer.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return places.listByEmployer(employer.id, opts);
    },
  };
}