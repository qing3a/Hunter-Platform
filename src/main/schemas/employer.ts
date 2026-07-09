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

// =============================================================================
// Employer job CRUD / lifecycle (Task 5 backend gap fill)
// =============================================================================

/**
 * GET /v1/employer/jobs/:id — single-job detail response. Mirrors `JobSchema`
 * so the edit form can hydrate from a canonical payload rather than the
 * filtered `list` row.
 */
export const GetJobResponseSchema = EnvelopeSchema(JobSchema);

/**
 * PATCH /v1/employer/jobs/:id — edit-form submission. Every field is
 * optional (this is a partial-update endpoint). The set is the same as
 * CreateJobSchema minus the keys that must not be edited:
 *   - `employer_id` / `source_headhunter_id` / `created_for_employer_id` —
 *     ownership is immutable; assignments move through the claim / reject flow.
 *   - `status` — status is mutated through the dedicated `pause` / `resume` /
 *     `close` endpoints so the lifecycle state machine stays in one place.
 *
 * `.strict()` so unknown keys cause a 400 (not a silent strip).
 */
export const UpdateJobRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  required_skills: z.array(z.string().min(1).max(100)).max(20).optional(),
  salary_min: z.number().int().positive().optional(),
  salary_max: z.number().int().positive().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  deadline: z.string().nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
}).strict();

/**
 * PATCH /v1/employer/jobs/:id response — the updated Job row.
 */
export const UpdateJobResponseSchema = EnvelopeSchema(JobSchema);

/**
 * POST /v1/employer/jobs/:id/{pause,resume,close} response — minimal
 * acknowledgement: `{ id, status }`. Full job state isn't re-fetched;
 * the SPA navigates to the list (or refreshes detail) after the action.
 */
export const JobActionResponseSchema = EnvelopeSchema(
  z.object({
    id: IdString,
    status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  })
);