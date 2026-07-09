import { randomUUID } from 'node:crypto';
import type { DB } from '../../db/connection.js';
import type { User, Job, AnonymizedCandidate } from '../../../shared/types.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createUnlockAuditLogRepo } from '../../db/repositories/unlock-audit-log.js';
import { createWebhookQueueRepo } from '../../db/repositories/webhook-delivery-queue.js';
import { getTraceparentFromContext, withSpanSync } from '../../telemetry.js';
import { createQuotaManager } from '../quota/manager.js';
import { encrypt, decrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { recFlow, jobFlow, applyTransition } from '../../flows/index.js';
import { QUOTA_COSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';
import { SALARY_BANDS } from '../desensitize/mapping.js';
import type { NotificationTrigger } from '../notification/trigger.js';

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

export function createEmployerHandler(db: DB, notifTrigger?: NotificationTrigger) {
  const jobs = createJobsRepo(db);
  const users = createUsersRepo(db);
  const candidatesAnon = createCandidatesAnonymizedRepo(db);
  const recommendations = createRecommendationsRepo(db);
  const auditLog = createUnlockAuditLogRepo(db);
  const webhooks = createWebhookQueueRepo(db);
  const quota = createQuotaManager(db);
  const notif = notifTrigger;

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

        const candidateAnon = candidatesAnon.findById(rec.anonymized_candidate_id);
        if (!candidateAnon) throw new Error('Anonymized candidate not found');

        const priv = db.prepare('SELECT candidate_user_id FROM candidates_private WHERE id = ?').get(candidateAnon.source_private_id) as { candidate_user_id: string } | undefined;
        if (!priv) throw new Error('Candidate user not found');

        let result;
        try {
          result = applyTransition(recFlow, rec.status, 'express_interest', { candidate_user_id: priv.candidate_user_id });
        } catch (e) {
          throw Errors.invalidState(`Invalid state: cannot express interest from status ${rec.status}`);
        }

        recommendations.updateStatus(rec.id, result.next);

        auditLog.insert({
          recommendation_id: rec.id, actor_user_id: user.id, action: 'express_interest',
          ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
        });

        const payload = {
          recommendation_id: rec.id,
          anonymized_candidate_id: rec.anonymized_candidate_id,
          employer_id: user.id,
          job_id: rec.job_id,
          requested_at: new Date().toISOString(),
        };
        const payloadEnc = encrypt(ctx.encryptionKey, JSON.stringify(payload));

        // C1 fix: dispatch webhook declared in recFlow for this transition.
        if (result.sideEffect?.kind === 'webhook') {
          webhooks.enqueue({
            target_user_id: result.sideEffect.target_user_id as string,
            event_type: result.sideEffect.event_type as any,
            payload_enc: payloadEnc,
            contains_pii: (result.sideEffect.contains_pii as 0 | 1 | undefined) ?? 0,
            traceparent: getTraceparentFromContext() ?? null,
          });
        }
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
      return withSpanSync('employer.unlock', {
        'employer.id': user.id,
        'recommendation.id': input.recommendation_id,
      }, () => {
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

        let transitionResult;
        try {
          transitionResult = applyTransition(recFlow, rec.status, 'unlock', { employer_id: user.id });
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

          recommendations.updateStatus(rec.id, transitionResult.next);

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

          // C1 fix: dispatch webhook declared in recFlow for this transition.
          // The 'unlock' event's side effect is 'deliver_contact' (contains_pii: 1).
          if (transitionResult.sideEffect?.kind === 'webhook') {
            webhooks.enqueue({
              target_user_id: transitionResult.sideEffect.target_user_id as string,
              event_type: transitionResult.sideEffect.event_type as any,
              payload_enc: payloadEnc,
              contains_pii: (transitionResult.sideEffect.contains_pii as 0 | 1 | undefined) ?? 1,
              traceparent: getTraceparentFromContext() ?? null,
            });
          }

          // v1.9.0: 通知候选人联系方式被解锁
          if (notif) {
            notif.notify({
              userId: priv.candidate_user_id,
              category: 'unlock_granted',
              title: `${user.name ?? '某雇主'} 解锁了您的联系方式`,
              payload: { recommendation_id: rec.id, employer_id: user.id },
              dedupKey: `unlock:${priv.candidate_user_id}:${user.id}`,
            });
          }
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
      });
    },

    // v009: 雇主"待认领"列表 (spec §5.1, §5.2)
    listPendingClaims(user: User): Job[] {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers');
      return jobs.findPendingClaims(user.id);
    },

    // v009: 雇主认领 (spec §5.2)
    claimJob(user: User, input: { job_id: string }): Job {
      return withSpanSync('employer.claim', {
        'employer.id': user.id,
        'job.id': input.job_id,
      }, () => {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can claim jobs');

      // 先校验: 存在 + 属于自己 (created_for_employer_id=me 或 null)
      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.employer_id !== null && job.employer_id !== user.id) {
        throw Errors.invalidState('Job already claimed by another employer');
      }
      // idempotent: 已经是自己 — return as-is (no DB write)
      if (job.employer_id === user.id && job.status === 'claimed') return job;

      // Only 'open' jobs can transition to 'claimed'
      if (job.status !== 'open') throw Errors.invalidState(`Cannot claim job in status ${job.status}`);

      // 权限校验: created_for_employer_id 必须 = me 或 null
      if (job.created_for_employer_id !== null && job.created_for_employer_id !== user.id) {
        throw Errors.forbidden('Job not pending for you');
      }

      const claimed = jobs.claimByEmployer(input.job_id, user.id);
      if (!claimed) throw Errors.invalidState('Claim race: job no longer available');
      return claimed;
      });
    },

    // v009: 雇主拒绝 (spec §5.3)
    rejectJob(user: User, input: { job_id: string; reason?: string | null }): { status: string } {
      return withSpanSync('employer.reject', {
        'employer.id': user.id,
        'job.id': input.job_id,
        'reject.reason': input.reason ?? '',
      }, () => {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can reject jobs');

      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.employer_id !== null && job.employer_id !== user.id) {
        throw Errors.forbidden('Not your job to reject');
      }
      if (job.created_for_employer_id !== null && job.created_for_employer_id !== user.id && job.employer_id === null) {
        throw Errors.forbidden('Job not pending for you');
      }

      // State-machine check: reject only from 'open' (claimed employers must
      // explicitly close the job, not reject it).
      try {
        applyTransition(jobFlow, job.status, 'reject', {});
      } catch (e) {
        throw Errors.invalidState(`Cannot reject job in status ${job.status}`);
      }

      db.exec('BEGIN');
      try {
        jobs.updateStatus(input.job_id, 'closed');
        // 写 action_history
        db.prepare(`
          INSERT INTO action_history (user_id, capability_name, target_type, target_id, request_summary_json, status, created_at)
          VALUES (?, 'employer.reject_job', 'job', ?, ?, 'success', ?)
        `).run(user.id, input.job_id, JSON.stringify({ reason: input.reason ?? null }), new Date().toISOString());
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return { status: 'closed' };
      });
    },

    // ========================================================================
    // Task 5 backend gap fill: GET / PATCH / pause / resume / close
    // ========================================================================

    /**
     * GET /v1/employer/jobs/:id — load a single job owned by the caller.
     * Ownership is enforced: a job belonging to a different employer returns
     * NOT_FOUND (not FORBIDDEN — no information leak about whether the id
     * exists).
     */
    getJob(user: User, input: { id: string }): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can view jobs');
      const job = jobs.findById(input.id);
      if (!job) throw Errors.notFound('Job not found');
      if (job.employer_id !== user.id) throw Errors.notFound('Job not found');
      return job;
    },

    /**
     * PATCH /v1/employer/jobs/:id — edit-form submission. The input is
     * already validated by the route's UpdateJobRequestSchema (and is
     * therefore a strict subset of the editable fields — no status /
     * ownership cols leak in). Ownership is enforced via the repo's
     * `employer_id = ?` clause; a row that didn't match returns 0 changes
     * which we surface as NOT_FOUND.
     *
     * `updated_at` is bumped server-side regardless of which fields the
     * caller sent (no-op on truly-empty updates is filtered at the route
     * layer so we always have something to apply here).
     */
    updateJob(user: User, input: { id: string; fields: Record<string, unknown> }): Job {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can edit jobs');
      const existing = jobs.findById(input.id);
      if (!existing) throw Errors.notFound('Job not found');
      if (existing.employer_id !== user.id) throw Errors.notFound('Job not found');

      jobs.updateFields(input.id, user.id, input.fields as Partial<Job>);
      const after = jobs.findById(input.id);
      if (!after) throw Errors.notFound('Job not found');
      return after;
    },

    /**
     * POST /v1/employer/jobs/:id/pause — flip `open` → `paused`. The repo's
     * conditional update enforces the state machine atomically:
     *
     *   - missing job            → 0 changes → NOT_FOUND
     *   - not owned              → 0 changes (employer_id mismatch) → NOT_FOUND
     *   - current status ∉ {open} → 0 changes → INVALID_STATE
     *   - happy path             → 1 change → status now 'paused'
     *
     * 'claimed' is intentionally NOT in allowedFrom — a claimed job is owned
     * by an employer who already has it, and the audit-trail reason for
     * pausing (status flip without action) doesn't apply. Reject first if
     * the claim was unwanted, then pause as needed.
     */
    pauseJob(user: User, input: { id: string }): { id: string; status: 'paused' } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can pause jobs');
      const existing = jobs.findById(input.id);
      if (!existing || existing.employer_id !== user.id) throw Errors.notFound('Job not found');
      if (existing.status !== 'open') {
        throw Errors.invalidState(`Cannot pause job in status ${existing.status}`);
      }
      const changes = jobs.updateStatusIfCurrent(input.id, user.id, ['open'], 'paused');
      if (changes === 0) {
        // Lost a race (status changed between read & write) — surface as
        // invalid-state so the SPA can refresh.
        throw Errors.invalidState(`Cannot pause job — status changed concurrently`);
      }
      return { id: input.id, status: 'paused' };
    },

    /**
     * POST /v1/employer/jobs/:id/resume — flip `paused` → `open`.
     * Same ownership + state-machine shape as pauseJob.
     */
    resumeJob(user: User, input: { id: string }): { id: string; status: 'open' } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can resume jobs');
      const existing = jobs.findById(input.id);
      if (!existing || existing.employer_id !== user.id) throw Errors.notFound('Job not found');
      if (existing.status !== 'paused') {
        throw Errors.invalidState(`Cannot resume job in status ${existing.status}`);
      }
      const changes = jobs.updateStatusIfCurrent(input.id, user.id, ['paused'], 'open');
      if (changes === 0) {
        throw Errors.invalidState(`Cannot resume job — status changed concurrently`);
      }
      return { id: input.id, status: 'open' };
    },

    /**
     * POST /v1/employer/jobs/:id/close — hard-close from `open` or `paused`.
     * Terminal state: once a job is closed the SPA should expect any
     * subsequent pause/resume call to fail with INVALID_STATE.
     */
    closeJob(user: User, input: { id: string }): { id: string; status: 'closed' } {
      if (user.user_type !== 'employer') throw Errors.forbidden('Only employers can close jobs');
      const existing = jobs.findById(input.id);
      if (!existing || existing.employer_id !== user.id) throw Errors.notFound('Job not found');
      const changes = jobs.updateStatusIfCurrent(input.id, user.id, ['open', 'paused'], 'closed');
      if (changes === 0) {
        throw Errors.invalidState(`Cannot close job in status ${existing.status}`);
      }
      return { id: input.id, status: 'closed' };
    },
  };
}
