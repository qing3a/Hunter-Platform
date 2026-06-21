import type { DB } from '../../db/connection.js';
import { randomUUID } from 'node:crypto';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createRecommendationsRepo } from '../../db/repositories/recommendations.js';
import { createJobsRepo } from '../../db/repositories/jobs.js';
import { createQuotaManager } from '../quota/manager.js';
import { encrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { withSpanSync } from '../../telemetry.js';
import { desensitize } from '../desensitize/engine.js';
import { QUOTA_COSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';
import type { User, AnonymizedCandidate, Recommendation, Job } from '../../../shared/types.js';

export interface UploadCandidateInput {
  candidate_user_id: string;
  name: string;
  phone: string;
  email: string;
  current_company?: string | undefined;
  current_title?: string | undefined;
  expected_salary?: number | undefined;
  years_experience?: number | undefined;
  education_school?: string | undefined;
  skills?: string[] | undefined;
}

export interface CreateJobForEmployerInput {
  title: string;
  description?: string | undefined;
  required_skills?: string[] | undefined;
  salary_min?: number | undefined;
  salary_max?: number | undefined;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | undefined;
  deadline?: string | undefined;
  industry?: string | undefined;
  created_for_employer_id?: string | undefined;
}

export function createHeadhunterHandler(db: DB, encryptionKey: Buffer) {
  const priv = createCandidatesPrivateRepo(db);
  const anon = createCandidatesAnonymizedRepo(db);
  const users = createUsersRepo(db);
  const jobsRepo = createJobsRepo(db);
  const quota = createQuotaManager(db);

  return {
    async uploadCandidate(user: User, input: UploadCandidateInput): Promise<{ anonymized_id: string; preview: AnonymizedCandidate; __audit: { target_type: 'candidate'; target_id: string; res_summary: { anonymized_id: string; industry: string | null; title_level: string | null } } }> {
      // 1. 验证 user 是 headhunter
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can upload candidates');

      // 2. 验证 candidate_user_id 存在且是 candidate 类型
      const candidateUser = users.findById(input.candidate_user_id);
      if (!candidateUser) throw Errors.invalidParams('candidate_user_id not found');
      if (candidateUser.user_type !== 'candidate') throw Errors.invalidParams('Referenced user is not a candidate');

      // 3. 配额扣减
      const quotaResult = quota.tryConsume(user.id, QUOTA_COSTS.upload_candidate);
      if (!quotaResult.ok) {
        if (quotaResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (quotaResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // 5. 加密 PII（用 Buffer 包装以便清零）
      const nameBuf = Buffer.from(input.name, 'utf8');
      const phoneBuf = Buffer.from(input.phone, 'utf8');
      const emailBuf = Buffer.from(input.email, 'utf8');
      try {
        const nameEnc = encrypt(encryptionKey, input.name);
        const phoneEnc = encrypt(encryptionKey, input.phone);
        const emailEnc = encrypt(encryptionKey, input.email);

        // 6. 脱敏
        const preview = desensitize({
          ...(input.current_company !== undefined && { current_company: input.current_company }),
          ...(input.current_title !== undefined && { current_title: input.current_title }),
          ...(input.expected_salary !== undefined && { expected_salary: input.expected_salary }),
          ...(input.years_experience !== undefined && { years_experience: input.years_experience }),
          ...(input.education_school !== undefined && { education_school: input.education_school }),
          ...(input.skills !== undefined && { skills: input.skills }),
        });

        // 7. 写库
        const now = new Date().toISOString();
        const privId = `cp_${randomUUID().slice(0, 12)}`;
        const anonId = `ca_${randomUUID().slice(0, 12)}`;

        priv.insert({
          id: privId, headhunter_id: user.id, candidate_user_id: input.candidate_user_id,
          name_enc: nameEnc, phone_enc: phoneEnc, email_enc: emailEnc,
          current_company_raw: input.current_company ?? null,
          current_title_raw: input.current_title ?? null,
          expected_salary: input.expected_salary ?? null,
          years_experience: input.years_experience ?? null,
          education_school: input.education_school ?? null,
          resume_url: null, skills_json: JSON.stringify(input.skills ?? []),
          raw_payload_json: null,
          created_at: now, updated_at: now,
        });

        anon.insert({
          id: anonId, source_private_id: privId, source_headhunter_id: user.id,
          industry: preview.industry, title_level: preview.title_level,
          years_experience: preview.years_experience, salary_range: preview.salary_range,
          education_tier: preview.education_tier, skills_json: JSON.stringify(preview.skills),
          is_public_pool: 0, unlock_status: 'locked',
          created_at: now, updated_at: now,
        });

        return {
          anonymized_id: anonId,
          preview,
          __audit: {
            target_type: 'candidate',
            target_id: anonId,
            res_summary: {
              anonymized_id: anonId,
              industry: preview.industry,
              title_level: preview.title_level,
            },
          },
        };
      } finally {
        // 立即清零内存中的 PII
        zeroMemory(nameBuf);
        zeroMemory(phoneBuf);
        zeroMemory(emailBuf);
      }
    },

    recommendCandidate(user: User, input: { anonymized_candidate_id: string; job_id: string; commission_split?: { hunter: number; referrer: number }; referrer_headhunter_id?: string }): Recommendation {
      return withSpanSync('headhunter.recommend', {
        'headhunter.id': user.id,
        'job.id': input.job_id,
        'anonymized_candidate.id': input.anonymized_candidate_id,
      }, (span) => {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can recommend');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.recommend_candidate);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      const anon = db.prepare('SELECT source_headhunter_id FROM candidates_anonymized WHERE id = ?').get(input.anonymized_candidate_id) as { source_headhunter_id: string } | undefined;
      if (!anon) throw Errors.notFound('Candidate not found');
      if (anon.source_headhunter_id !== user.id) throw Errors.forbidden('Forbidden: not your candidate');

      const jobs = createJobsRepo(db);
      const job = jobs.findById(input.job_id);
      if (!job) throw Errors.notFound('Job not found');
      // Allow recommending to 'open' (legacy) and 'claimed' (post-claim) jobs.
      // 'paused' / 'closed' / 'filled' are terminal/paused and reject.
      if (job.status === 'closed' || job.status === 'filled' || job.status === 'paused') {
        throw Errors.invalidParams(`Job is ${job.status}`);
      }
      // v009: 未认领的 job 不允许被推荐 (recommendation.employer_id NOT NULL, 且
      // spec §5.4 决策 "未认领就 unlock" 禁止)
      if (job.employer_id === null) {
        throw Errors.invalidState('Cannot recommend to unclaimed job');
      }

      const recs = createRecommendationsRepo(db);
      const existing = recs.findByCandidateAndJob(input.anonymized_candidate_id, input.job_id);
      if (existing) throw Errors.duplicateRequest('Already recommended this candidate for this job');

      const now = new Date().toISOString();
      const rec: Recommendation = {
        id: `rec_${randomUUID().slice(0, 12)}`,
        headhunter_id: user.id,
        employer_id: job.employer_id,
        anonymized_candidate_id: input.anonymized_candidate_id,
        job_id: input.job_id,
        status: 'pending',
        commission_split_json: input.commission_split ? JSON.stringify(input.commission_split) : null,
        referrer_headhunter_id: input.referrer_headhunter_id ?? null,
        created_at: now,
        updated_at: now,
      };
      recs.insert(rec);
      span.setAttribute('recommendation.id', rec.id);
      return rec;
      });
    },

    withdrawRecommendation(user: User, input: { recommendation_id: string }): void {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can withdraw');
      const recs = createRecommendationsRepo(db);
      const rec = recs.findById(input.recommendation_id);
      if (!rec) throw Errors.notFound('Recommendation not found');
      if (rec.headhunter_id !== user.id) throw Errors.forbidden('Forbidden: not your recommendation');
      if (rec.status !== 'pending') throw Errors.invalidState('Can only withdraw pending recommendations');
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.withdraw_recommendation);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }
      recs.updateStatus(rec.id, 'withdrawn');
    },

    publishToPool(user: User, input: { anonymized_candidate_id: string }): void {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can publish');
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.publish_to_pool);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }
      const anon = db.prepare('SELECT source_headhunter_id FROM candidates_anonymized WHERE id = ?').get(input.anonymized_candidate_id) as { source_headhunter_id: string } | undefined;
      if (!anon) throw Errors.notFound('Candidate not found');
      if (anon.source_headhunter_id !== user.id) throw Errors.forbidden('Forbidden: not your candidate');
      db.prepare("UPDATE candidates_anonymized SET is_public_pool = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), input.anonymized_candidate_id);
    },

    listMyRecommendations(user: User, opts: { status?: any } = {}): Recommendation[] {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can list recommendations');
      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.list_recommendations);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }
      const recs = createRecommendationsRepo(db);
      return recs.listByHeadhunter(user.id, opts);
    },

    // v009: 猎头代雇主建岗 (spec §5.1)
    createJobForEmployer(user: User, input: CreateJobForEmployerInput): Job {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can create jobs on behalf of employers');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.create_job);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // 可选: 校验 created_for_employer_id 指向 employer
      if (input.created_for_employer_id) {
        const target = users.findById(input.created_for_employer_id);
        if (!target) throw Errors.notFound('Target employer not found');
        if (target.user_type !== 'employer') {
          throw Errors.forbidden('created_for_employer_id must point to an employer');
        }
      }

      // 校验 salary_min <= salary_max
      if (input.salary_min != null && input.salary_max != null && input.salary_min > input.salary_max) {
        throw Errors.invalidParams('salary_min cannot exceed salary_max');
      }

      const now = new Date().toISOString();
      const job: Job = {
        id: `job_${randomUUID().slice(0, 12)}`,
        employer_id: null,                          // 关键: 未认领
        source_headhunter_id: user.id,              // 关键: 标记建岗者
        created_for_employer_id: input.created_for_employer_id ?? null,
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
      jobsRepo.insert(job);
      return job;
    },

    listMyCreatedJobs(user: User): Job[] {
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters');
      return jobsRepo.findBySourceHeadhunter(user.id);
    },
  };
}
