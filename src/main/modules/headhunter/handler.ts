import type { DB } from '../../db/connection.js';
import { randomUUID } from 'node:crypto';
import { createCandidatesPrivateRepo } from '../../db/repositories/candidates-private.js';
import { createCandidatesAnonymizedRepo } from '../../db/repositories/candidates-anonymized.js';
import { createUsersRepo } from '../../db/repositories/users.js';
import { createQuotaManager } from '../quota/manager.js';
import { createRateLimit } from '../rate-limit/bucket.js';
import { encrypt, zeroMemory } from '../crypto/aes-gcm.js';
import { desensitize } from '../desensitize/engine.js';
import { QUOTA_COSTS, RATE_LIMIT_BURSTS } from '../../../shared/constants.js';
import { Errors } from '../../errors.js';
import type { User, AnonymizedCandidate } from '../../../shared/types.js';

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

export function createHeadhunterHandler(db: DB, encryptionKey: Buffer) {
  const priv = createCandidatesPrivateRepo(db);
  const anon = createCandidatesAnonymizedRepo(db);
  const users = createUsersRepo(db);
  const quota = createQuotaManager(db);
  const rl = createRateLimit(db);

  return {
    async uploadCandidate(user: User, input: UploadCandidateInput): Promise<{ anonymized_id: string; preview: AnonymizedCandidate }> {
      // 1. 验证 user 是 headhunter
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can upload candidates');

      // 2. 验证 candidate_user_id 存在且是 candidate 类型
      const candidateUser = users.findById(input.candidate_user_id);
      if (!candidateUser) throw Errors.invalidParams('candidate_user_id not found');
      if (candidateUser.user_type !== 'candidate') throw Errors.invalidParams('Referenced user is not a candidate');

      // 3. 突发限流
      const limits = RATE_LIMIT_BURSTS.headhunter;
      const rlResult = rl.check(user.id, [
        { windowSeconds: 1, limit: limits.second },
        { windowSeconds: 60, limit: limits.minute },
        { windowSeconds: 3600, limit: limits.hour },
      ]);
      if (!rlResult.allowed) throw Errors.rateLimited('Burst rate limit exceeded');

      // 4. 配额扣减
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

        return { anonymized_id: anonId, preview };
      } finally {
        // 立即清零内存中的 PII
        zeroMemory(nameBuf);
        zeroMemory(phoneBuf);
        zeroMemory(emailBuf);
      }
    },
  };
}
