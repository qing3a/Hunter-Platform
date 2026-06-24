import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import { createPlacementsRepo, type Placement } from '../../db/repositories/placements.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createAdminActionLogRepo } from '../../db/repositories/admin-action-log.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { calculateCommission } from './calculator.js';
import { Errors } from '../../errors.js';
import { encrypt } from '../crypto/aes-gcm.js';
import type { User } from '../../../shared/types.js';
import { getTraceparentFromContext, withSpanSync } from '../../telemetry.js';
import type { NotificationTrigger } from '../notification/trigger.js';

export interface CreatePlacementInput {
  anonymized_candidate_id: string;
  job_id: string;
  annual_salary: number;
}

export function createCommissionHandler(db: DB, encryptionKey: Buffer, notifTrigger?: NotificationTrigger) {
  const notif = notifTrigger;
  const places = createPlacementsRepo(db);
  const recs = createRecommendationsRepo(db);
  const jobs = createJobsRepo(db);
  const adminLog = createAdminActionLogRepo(db);
  const webhooks = createWebhookQueueRepo(db);

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
      return withSpanSync('employer.create_placement', {
        'employer.id': employer.id,
        'job.id': input.job_id,
        'anonymized_candidate.id': input.anonymized_candidate_id,
        'placement.annual_salary': input.annual_salary,
      }, (span) => {
      if (employer.user_type !== 'employer') throw Errors.forbidden('Only employers can create placements');

      const rec = recs.findByCandidateAndJob(input.anonymized_candidate_id, input.job_id);
      if (!rec) throw Errors.notFound('No recommendation for this candidate + job');
      if (rec.employer_id !== employer.id) throw Errors.forbidden('Not your recommendation');
      if (rec.status !== 'unlocked') throw Errors.invalidState(`Invalid state: recommendation status is ${rec.status}, must be 'unlocked'`);

      const job = jobs.findById(input.job_id);
      if (!job || job.employer_id !== employer.id) throw Errors.forbidden('Not your job');

      // v009: 猎头代雇主建岗场景下, 70% 给推荐者, 30% 给建岗猎头
      // 同人 (creator == recommender) 时 100% 给本人
      // creator 覆盖原 referral chain (即使 rec.referrer_headhunter_id 存在)
      let referrerForCommission: string | null = null;
      if (job.source_headhunter_id !== null) {
        if (job.source_headhunter_id === rec.headhunter_id) {
          referrerForCommission = null;  // 同人: 100%
        } else {
          referrerForCommission = job.source_headhunter_id;  // 跨人: 30% 给建岗者
        }
      } else {
        referrerForCommission = rec.referrer_headhunter_id;  // 雇主直发: 老逻辑
      }

      const commission = calculateCommission({
        annual_salary: input.annual_salary,
        referrer_headhunter_id: referrerForCommission,
      });

      const now = new Date().toISOString();
      const placement: Placement = {
        id: `pl_${randomUUID().slice(0, 12)}`,
        job_id: input.job_id,
        candidate_user_id: findCandidateUserId(input.anonymized_candidate_id),
        primary_headhunter_id: rec.headhunter_id,
        referrer_headhunter_id: referrerForCommission,
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

      span.setAttribute('placement.id', placement.id);

      // Bug #4: emit placement_created webhook to the headhunter (and referrer if any)
      // so their agent knows to expect a commission / next step. Payload contains no
      // PII (no name / phone / email of the candidate).
      const payload = {
        placement_id: placement.id,
        job_id: placement.job_id,
        anonymized_candidate_id: placement.anonymized_candidate_id,
        annual_salary: placement.annual_salary,
        platform_fee: placement.platform_fee,
        primary_share: placement.primary_share,
        referrer_share: placement.referrer_share,
        status: placement.status,
        created_at: placement.created_at,
      };
      const payload_enc = encrypt(encryptionKey, JSON.stringify(payload));
      const placementTraceparent = getTraceparentFromContext() ?? null;
      webhooks.enqueue({
        target_user_id: placement.primary_headhunter_id,
        event_type: 'placement_created',
        payload_enc,
        contains_pii: 0,
        traceparent: placementTraceparent,
      });
      if (placement.referrer_headhunter_id) {
        webhooks.enqueue({
          target_user_id: placement.referrer_headhunter_id,
          event_type: 'placement_created',
          payload_enc,
          contains_pii: 0,
          traceparent: placementTraceparent,
        });
      }

      // v1.9.0: notify primary headhunter of placement creation (close to "placement_confirmed")
      if (notif) {
        notif.notify({
          userId: placement.primary_headhunter_id,
          category: 'placement_confirmed',
          title: '候选人已确认入职，请等待佣金到账',
          payload: { placement_id: placement.id, job_id: placement.job_id },
        });
      }

      return placement;
      });
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
      // v1.9.0: notify primary headhunter that commission has been paid
      if (notif) {
        const amount = p.primary_share + p.referrer_share;
        notif.notify({
          userId: p.primary_headhunter_id,
          category: 'commission_paid',
          title: `佣金 ${amount} 元已到账`,
          payload: { placement_id: p.id, amount },
        });
        // Also notify the referrer if they get a separate share
        if (p.referrer_headhunter_id && p.referrer_headhunter_id !== p.primary_headhunter_id) {
          notif.notify({
            userId: p.referrer_headhunter_id,
            category: 'commission_paid',
            title: `建岗佣金 ${p.referrer_share} 元已到账`,
            payload: { placement_id: p.id, amount: p.referrer_share },
          });
        }
      }
      return places.findById(placementId)!;
    },

    listPlacements(employer: User, opts: { status?: 'pending_payment' | 'paid' | 'cancelled' } = {}): Placement[] {
      if (employer.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return places.listByEmployer(employer.id, opts);
    },
  };
}