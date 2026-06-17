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
import { encrypt, zeroMemory } from '../crypto/aes-gcm.js';
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
  };
}
