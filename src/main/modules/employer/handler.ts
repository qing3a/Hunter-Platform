import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { User, Job, AnonymizedCandidate } from '../../../shared/types.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { createQuotaManager } from '../quota/manager.js';
import { createRateLimit } from '../rate-limit/bucket.js';
import { encrypt, decrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { assertTransition } from '../unlock/state-machine.js';
import { QUOTA_COSTS, RATE_LIMIT_BURSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';

export interface CreateJobInput {
  title: string;
  description?: string;
  requirements?: string;
  salary_min?: number;
  salary_max?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  deadline?: string;
  industry?: string;
}

export function createEmployerHandler(db: DB) {
  const jobs = createJobsRepo(db);
  const users = createUsersRepo(db);
  const candidatesAnon = createCandidatesAnonymizedRepo(db);
  const recommendations = createRecommendationsRepo(db);
  const auditLog = createUnlockAuditLogRepo(db);
  const webhooks = createWebhookQueueRepo(db);
  const quota = createQuotaManager(db);
  const rl = createRateLimit(db);

  return {
    createJob(user: User, input: CreateJobInput): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can create jobs');

      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.create_job);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const now = new Date().toISOString();
      const job: Job = {
        id: `job_${randomUUID().slice(0, 12)}`,
        employer_id: user.id,
        title: input.title,
        description: input.description ?? null,
        requirements: input.requirements ?? null,
        salary_min: input.salary_min ?? null,
        salary_max: input.salary_max ?? null,
        status: 'open',
        priority: input.priority ?? 'normal',
        deadline: input.deadline ?? null,
        industry: input.industry ?? null,
        created_at: now,
        updated_at: now,
      };
      jobs.insert(job);
      return job;
    },

    listMyJobs(user: User, opts: { status?: any } = {}): Job[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return jobs.listByEmployer(user.id, opts);
    },

    browseTalent(user: User, filters: { industry?: string; title_level?: string; min_years?: number; max_years?: number; skills?: string[] }): AnonymizedCandidate[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can browse talent');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.browse_talent);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const all = db.prepare(
        'SELECT * FROM candidates_anonymized WHERE is_public_pool = 1 ORDER BY created_at DESC LIMIT 100'
      ).all() as any[];

      return all
        .filter(c => {
          if (filters.industry && c.industry !== filters.industry) return false;
          if (filters.title_level && c.title_level !== filters.title_level) return false;
          if (filters.min_years != null && (c.years_experience ?? 0) < filters.min_years) return false;
          if (filters.max_years != null && (c.years_experience ?? 0) > filters.max_years) return false;
          if (filters.skills && filters.skills.length > 0) {
            const candSkills: string[] = JSON.parse(c.skills_json ?? '[]');
            if (!filters.skills.some(s => candSkills.includes(s))) return false;
          }
          return true;
        })
        .map(c => ({
          id: c.id,
          anonymized_id: c.id,
          industry: c.industry,
          title_level: c.title_level,
          years_experience: c.years_experience,
          salary_range: c.salary_range,
          education_tier: c.education_tier,
          skills: JSON.parse(c.skills_json ?? '[]'),
        }));
    },

    expressInterest(
      user: User,
      input: { recommendation_id: string },
      ctx: { encryptionKey: Buffer; ip?: string; userAgent?: string } = { encryptionKey: Buffer.alloc(32) },
    ): void {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can express interest');

      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.express_interest);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // node:sqlite doesn't have db.transaction(); use explicit BEGIN/COMMIT
      // (consistent with M1 pattern in src/main/db/migrations.ts).
      db.exec('BEGIN');
      try {
        const rec = recommendations.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');
        if (rec.employer_id !== user.id) throw Errors.forbidden('Forbidden: not your recommendation');

        try {
          assertTransition(rec.status, 'employer_interested');
        } catch (e) {
          throw Errors.invalidState(`Invalid state: cannot express interest from status ${rec.status}`);
        }

        recommendations.updateStatus(rec.id, 'employer_interested');

        auditLog.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'express_interest',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });

        const candidateAnon = candidatesAnon.findById(rec.anonymized_candidate_id);
        if (!candidateAnon) throw new Error('Anonymized candidate not found');

        const priv = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = ?').get(candidateAnon.source_private_id) as { candidate_user_id: string } | undefined;
        if (!priv) throw new Error('Candidate user not found');

        const payload = {
          recommendation_id: rec.id,
          anonymized_candidate_id: rec.anonymized_candidate_id,
          employer_id: user.id,
          job_id: rec.job_id,
          requested_at: new Date().toISOString(),
        };
        const payloadEnc = encrypt(ctx.encryptionKey, JSON.stringify(payload));

        webhooks.enqueue({
          target_user_id: priv.candidate_user_id,
          event_type: 'notify_unlock_request',
          payload_enc: payloadEnc,
          contains_pii: 0,
        });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    unlockContact(
      user: User,
      input: { recommendation_id: string },
      ctx: { encryptionKey: Buffer; ip?: string; userAgent?: string },
    ): void {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can unlock contact');

      const limits = RATE_LIMIT_BURSTS.employer;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.unlock_contact);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      db.exec('BEGIN');
      try {
        const rec = recommendations.findById(input.recommendation_id);
        if (!rec) throw Errors.notFound('Recommendation not found');
        if (rec.employer_id !== user.id) throw Errors.forbidden('Forbidden: not your recommendation');

        try {
          assertTransition(rec.status, 'unlocked');
        } catch (e) {
          throw Errors.invalidState(`Invalid state: cannot unlock from status ${rec.status}`);
        }

        const anon = candidatesAnon.findById(rec.anonymized_candidate_id);
        if (!anon) throw new Error('Anonymized candidate not found');
        const priv = db.prepare('SELECT * FROM candidates_private WHERE id = ?').get(anon.source_private_id) as any;
        if (!priv) throw new Error('Private candidate not found');

        let name = '';
        let phone = '';
        let email = '';
        let nameBuf: Buffer | null = null;
        let phoneBuf: Buffer | null = null;
        let emailBuf: Buffer | null = null;
        try {
          name = decrypt(ctx.encryptionKey, priv.name_enc);
          phone = decrypt(ctx.encryptionKey, priv.phone_enc);
          email = decrypt(ctx.encryptionKey, priv.email_enc);
          nameBuf = Buffer.from(name, 'utf8');
          phoneBuf = Buffer.from(phone, 'utf8');
          emailBuf = Buffer.from(email, 'utf8');

          recommendations.updateStatus(rec.id, 'unlocked');

          auditLog.insert({
            recommendation_id: rec.id, actor_user_id: user.id, action: 'unlock_delivery',
            ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
          });

          const payload = {
            recommendation_id: rec.id,
            candidate_id: priv.candidate_user_id,
            name, phone, email,
          };
          const payloadEnc = encrypt(ctx.encryptionKey, JSON.stringify(payload));

          webhooks.enqueue({
            target_user_id: user.id,
            event_type: 'deliver_contact',
            payload_enc: payloadEnc,
            contains_pii: 1,
          });
        } finally {
          if (nameBuf) zeroMemory(nameBuf);
          if (phoneBuf) zeroMemory(phoneBuf);
          if (emailBuf) zeroMemory(emailBuf);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
