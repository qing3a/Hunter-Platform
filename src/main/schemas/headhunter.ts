import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString } from './common.js';

const SkillListSchema = z.array(z.string());
const SalaryRangeSchema = z.string().nullable();

const RecommendationSchema = z.object({
  id: IdString,
  headhunter_id: IdString,
  employer_id: IdString,
  anonymized_candidate_id: IdString,
  job_id: IdString,
  status: z.enum([
    'pending', 'employer_interested', 'candidate_approved',
    'unlocked', 'rejected_employer', 'rejected_candidate',
    'withdrawn', 'placed',
  ]),
  commission_split_json: z.string().nullable(),
  referrer_headhunter_id: IdString.nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const JobSchema = z.object({
  id: IdString,
  employer_id: IdString.nullable(),
  source_headhunter_id: IdString.nullable(),
  created_for_employer_id: IdString.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  required_skills: z.array(z.string()),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  deadline: z.string().nullable(),
  industry: z.string().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const AnonymizedCandidatePreviewSchema = z.object({
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  years_experience: z.number().int().nullable(),
  salary_range: SalaryRangeSchema,
  education_tier: z.string().nullable(),
  skills: SkillListSchema,
});

export const UploadCandidateResponseSchema = EnvelopeSchema(
  z.object({
    anonymized_id: IdString,
    preview: AnonymizedCandidatePreviewSchema,
  })
);

export const RecommendResponseSchema = EnvelopeSchema(RecommendationSchema);

export const WithdrawResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('withdrawn') })
);

export const PublishResponseSchema = EnvelopeSchema(
  z.object({ published: z.literal(true) })
);

export const ListRecommendationsResponseSchema = EnvelopeSchema(
  z.array(RecommendationSchema)
);

export const ListMyCandidatesResponseSchema = EnvelopeSchema(
  z.array(AnonymizedCandidatePreviewSchema.extend({
    anonymized_id: IdString,
    source_private_id: IdString,
    source_headhunter_id: IdString,
    is_public_pool: z.union([z.literal(0), z.literal(1)]),
    unlock_status: z.string(),
    created_at: ISODateTime,
    updated_at: ISODateTime,
  }))
);

export const CreateJobForEmployerResponseSchema = EnvelopeSchema(JobSchema);

export const ListMyCreatedJobsResponseSchema = EnvelopeSchema(z.array(JobSchema));