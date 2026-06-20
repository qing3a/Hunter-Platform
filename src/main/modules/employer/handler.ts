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
import { encrypt, decrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { assertTransition } from '../unlock/state-machine.js';
import { QUOTA_COSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';
import { SALARY_BANDS } from '../desensitize/mapping.js';

export interface CreateJobInput {
  title: string;
  description?: string;
  required_skills?: string[];
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

  return {
    createJob(user: User, input: CreateJobInput): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can create jobs');

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
        source_headhunter_id: null,         // v009: 雇主直发, 没有 source_hh
        created_for_employer_id: null,      // v009: 雇主直发, 没有 created_for
        title: input.title,
        description: input.description ?? null,
        required_skills: input.required_skills ?? [],
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

    browseTalent(user: User, filters: { industry?: string; title_level?: string; min_years?: number; max_years?: number; skills?: string[]; min_salary?: number; max_salary?: number }): AnonymizedCandidate[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can browse talent');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.browse_talent);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // 把 [min_salary, max_salary] 映射到 SALARY_BANDS 的 label 集合
      let allowedSalaryLabels: Set<string> | null = null;
      const min = (filters.min_salary != null && filters.min_salary >= 0) ? filters.min_salary : null;
      const max = (filters.max_salary != null && filters.max_salary >= 0) ? filters.max_salary : null;
      if (min != null || max != null) {
        allowedSalaryLabels = new Set(
          SALARY_BANDS
            .filter(b => {
              // band 与 [min, max] 有交集才算命中
              if (min != null) {
                const bandMax = b.max ?? Number.POSITIVE_INFINITY;
                if (bandMax < min) return false;  // band 全部 < min
              }
              if (max != null) {
                if (b.min > max) return false;   // band 全部 > max
              }
              return true;
            })
            .map(b => b.label)
        );
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
          // salary range 过滤
          if (allowedSalaryLabels != null) {
            if (!c.salary_range) return false;  // 候选人无 salary_range 数据 → 排除
            if (!allowedSalaryLabels.has(c.salary_range)) return false;
          }
          return true;
        })
        .map(c => ({
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
    ): { __audit: { target_type: 'recommendation'; target_id: string } } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can express interest');

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
      return { __audit: { target_type: 'recommendation', target_id: input.recommendation_id } };
    },

    unlockContact(
      user: User,
      input: { recommendation_id: string },
      ctx: { encryptionKey: Buffer; ip?: string; userAgent?: string },
    ): { __audit: { target_type: 'recommendation'; target_id: string } } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can unlock contact');

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
      return { __audit: { target_type: 'recommendation', target_id: input.recommendation_id } };
    },

    // v009: 雇主"待认领"列表 (spec §5.1, §5.2)
    listPendingClaims(user: User): Job[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return jobs.findPendingClaims(user.id);
    },

    // v009: 雇主认领 (spec §5.2)
    claimJob(user: User, input: { job_id: string }): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can claim jobs');

      // 先校验: 存在 + 未认领 + 属于自己 (created_for_employer_id=me 或 null)
      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') throw Errors.invalidState(`Cannot claim job in status ${job.status}`);
      if (job.employer_id !== null && job.employer_id !== user.id) {
        throw Errors.invalidState('Job already claimed by another employer');
      }
      // idempotent: 已经是自己
      if (job.employer_id === user.id) return job;

      // 权限校验: created_for_employer_id 必须 = me 或 null
      if (job.created_for_employer_id !== null && job.created_for_employer_id !== user.id) {
        throw Errors.forbidden('Job not pending for you');
      }

      const claimed = jobs.claimByEmployer(input.job_id, user.id);
      if (!claimed) throw Errors.invalidState('Claim race: job no longer available');
      return claimed;
    },

    // v009: 雇主拒绝 (spec §5.3)
    rejectJob(user: User, input: { job_id: string; reason?: string | null }): { status: string } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can reject jobs');

      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.status !== 'open') throw Errors.invalidState(`Cannot reject job in status ${job.status}`);
      if (job.employer_id !== null && job.employer_id !== user.id) {
        throw Errors.forbidden('Not your job to reject');
      }
      if (job.created_for_employer_id !== null && job.created_for_employer_id !== user.id && job.employer_id === null) {
        throw Errors.forbidden('Job not pending for you');
      }

      db.exec('BEGIN');
      try {
        jobs.updateStatus(input.job_id, 'closed');
        // 写 action_history
        db.prepare(`
          INSERT INTO action_history (user_id, action_type, target_type, target_id, request_summary_json, status, created_at)
          VALUES (?, 'reject_job', 'job', ?, ?, 'success', ?)
        `).run(user.id, input.job_id, JSON.stringify({ reason: input.reason ?? null }), new Date().toISOString());
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return { status: 'closed' };
    },
  };
}
