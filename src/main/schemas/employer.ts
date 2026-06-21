import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString, JobSchema } from './common.js';

const SkillListSchema = z.array(z.string());

const TalentPreviewSchema = z.object({
  anonymized_id: IdString,
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  years_experience: z.number().int().nullable(),
  salary_range: z.string().nullable(),
  education_tier: z.string().nullable(),
  skills: SkillListSchema,
});

const PlacementSchema = z.object({
  id: IdString,
  job_id: IdString,
  candidate_user_id: IdString,
  primary_headhunter_id: IdString,
  referrer_headhunter_id: IdString.nullable(),
  anonymized_candidate_id: IdString,
  annual_salary: z.number().int().positive(),
  platform_fee: z.number().int(),
  primary_share: z.number().int(),
  referrer_share: z.number().int(),
  candidate_bonus: z.number().int(),
  status: z.enum(['pending_payment', 'paid', 'cancelled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

export const CreatePlacementResponseSchema = EnvelopeSchema(PlacementSchema);
export const ListPlacementsResponseSchema = EnvelopeSchema(z.array(PlacementSchema));
export const CreateJobResponseSchema = EnvelopeSchema(JobSchema);
export const ListMyJobsResponseSchema = EnvelopeSchema(z.array(JobSchema));
export const BrowseTalentResponseSchema = EnvelopeSchema(z.array(TalentPreviewSchema));
export const ExpressInterestResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('employer_interested') })
);
export const UnlockContactResponseSchema = EnvelopeSchema(
  z.object({ status: z.literal('unlocked') })
);
export const PendingClaimsResponseSchema = EnvelopeSchema(z.array(JobSchema));
export const ClaimJobResponseSchema = EnvelopeSchema(JobSchema);
export const RejectJobResponseSchema = EnvelopeSchema(
  z.object({ status: z.enum(['closed']) })
);