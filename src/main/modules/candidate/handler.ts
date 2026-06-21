import type { DB } from '../../db/connection.js';
import type { User } from '../../../shared/types.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { createQuotaManager } from '../quota/manager.js';
import { recFlow, applyTransition } from '../../flows/index.js';
import { QUOTA_COSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';
import { encrypt } from '../crypto/aes-gcm.js';
import { getTraceparentFromContext, withSpanSync } from '../../telemetry.js';

export interface ViewOpportunity {
  recommendation_id: string;
  job_id: string;
  job_title: string;
  job_salary_min: number | null;
  job_salary_max: number | null;
  employer_id: string;
  status: string;
  requested_at: string;
}

export function createCandidateHandler(db: DB, encryptionKey: Buffer) {
  const recs = createRecommendationsRepo(db);
  const audit = createUnlockAuditLogRepo(db);
  const priv = createCandidatesPrivateRepo(db);
  const jobs = createJobsRepo(db);
  const webhooks = createWebhookQueueRepo(db);
  const quota = createQuotaManager(db);

  return {
    viewOpportunities(user: User, opts: { status?: any } = {}): ViewOpportunity[] {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can view opportunities');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.view_opportunities);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const myAnons = db.prepare('SELECT id FROM candidates_anonymized WHERE source_private_id IN (SELECT id FROM candidates_private WHERE candidate_user_id = ?)').all(user.id) as { id: string }[];
      const anonIds = myAnons.map(a => a.id);
      if (anonIds.length === 0) return [];

      const placeholders = anonIds.map(() => '?').join(',');
      const sql = `SELECT r.*, j.title as job_title, j.salary_min as job_salary_min, j.salary_max as job_salary_max
                   FROM recommendations r
                   JOIN jobs j ON j.id = r.job_id
                   WHERE r.anonymized_candidate_id IN (${placeholders})
                   ${opts.status ? 'AND r.status = ?' : ''}
                   ORDER BY r.created_at DESC LIMIT 50`;
      const params: any[] = [...anonIds];
      if (opts.status) params.push(opts.status);
      const rows = db.prepare(sql).all(...params) as any[];

      const visible = new Set(['pending', 'employer_interested', 'candidate_approved']);
      return rows
        .filter(r => visible.has(r.status))
        .map(r => ({
          recommendation_id: r.id,
          job_id: r.job_id,
          job_title: r.job_title,
          job_salary_min: r.job_salary_min,
          job_salary_max: r.job_salary_max,
          employer_id: r.employer_id,
          status: r.status,
          requested_at: r.created_at,
        }));
    },

    approveUnlock(user: User, input: { recommendation_id: string }, ctx: { ip?: string; userAgent?: string } = {}): void {
      withSpanSync('candidate.approve_unlock', {
        'candidate.id': user.id,
        'recommendation.id': input.recommendation_id,
      }, () => {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can approve unlock');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.approve_unlock);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      db.exec('BEGIN');
      try {
        const rec = recs.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');

        const privRecord = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = (SELECT source_private_id FROM candidates_anonymized WHERE id = ?)').get(rec.anonymized_candidate_id) as { candidate_user_id: string } | undefined;
        if (!privRecord || privRecord.candidate_user_id !== user.id) throw Errors.forbidden('Forbidden: not your recommendation');

        let result;
        try {
          result = applyTransition(recFlow, rec.status, 'approve_unlock', { employer_id: rec.employer_id });
        } catch (e) {
          throw Errors.invalidState(`Invalid state: cannot approve from status ${rec.status}`);
        }

        recs.updateStatus(rec.id, result.next);
        audit.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'approve_unlock',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });
        const approvePayload = {
          recommendation_id: rec.id,
          anonymized_candidate_id: rec.anonymized_candidate_id,
          candidate_user_id: privRecord.candidate_user_id,
          approved_at: new Date().toISOString(),
        };
        // Side effect: dispatch webhook declared in recFlow for this transition.
        // C1 fix: previously these fields were hardcoded inline; now they come
        // from the flow definition, so future transitions can be added by
        // editing recFlow only.
        if (result.sideEffect?.kind === 'webhook') {
          webhooks.enqueue({
            target_user_id: result.sideEffect.target_user_id as string,
            event_type: result.sideEffect.event_type as any,
            payload_enc: encrypt(encryptionKey, JSON.stringify(approvePayload)),
            contains_pii: (result.sideEffect.contains_pii as 0 | 1 | undefined) ?? 0,
            traceparent: getTraceparentFromContext() ?? null,
          });
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      });
    },

    rejectUnlock(user: User, input: { recommendation_id: string }, ctx: { ip?: string; userAgent?: string } = {}): void {
      withSpanSync('candidate.reject_unlock', {
        'candidate.id': user.id,
        'recommendation.id': input.recommendation_id,
      }, () => {
      if (user.user_type !== 'candidate') throw Errors.forbidden('Only candidates can reject unlock');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.reject_unlock);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      db.exec('BEGIN');
      try {
        const rec = recs.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');

        const privRecord = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = (SELECT source_private_id FROM candidates_anonymized WHERE id = ?)').get(rec.anonymized_candidate_id) as { candidate_user_id: string } | undefined;
        if (!privRecord || privRecord.candidate_user_id !== user.id) throw Errors.forbidden('Forbidden: not your recommendation');

        let result;
        try {
          result = applyTransition(recFlow, rec.status, 'reject_candidate', {});
        } catch (e) {
          throw Errors.invalidState(`Invalid state: cannot reject from status ${rec.status}`);
        }

        recs.updateStatus(rec.id, result.next);
        audit.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'reject_unlock',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      });
    },
  };
}
