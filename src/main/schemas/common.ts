import { z, type ZodTypeAny } from 'zod';

/**
 * Standard API response envelope helper.
 *
 * Returns a zod schema that accepts `{ ok: true, data: <dataSchema> }`.
 * Used by every response schema in `src/main/schemas/<domain>.ts`.
 *
 * Helper, not a wrapper: routes declare their data schema explicitly and
 * pass the full envelope schema to `respond()`.
 */
export function EnvelopeSchema<T extends ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}

/** ISO 8601 datetime string */
export const ISODateTime = z.string().refine(
  (s) => !Number.isNaN(new Date(s).getTime()),
  { message: 'must be ISO 8601 datetime' }
);

/** Generic ID-shaped string (e.g. user_xxx, job_xxx, rec_xxx) */
export const IdString = z.string().min(1).max(64);

export const OkResponse = z.object({ ok: z.literal(true) });

export const StatusResponse = z.object({ status: z.string() });

export const ErrorEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

/** User profile fields safe to expose to any authenticated caller. */
export const UserPublicSchema = z.object({
  id: IdString,
  user_type: z.enum(['candidate', 'headhunter', 'employer']),
  name: z.string(),
  quota_per_day: z.number().int(),
  quota_used: z.number().int(),
  quota_reset_at: ISODateTime,
  reputation: z.number().int(),
  status: z.enum(['active', 'suspended', 'deleted']),
  created_at: ISODateTime,
});

/**
 * Job posting fields — used by headhunter (create-for-employer, list-my-created)
 * and employer (create, list-mine, pending-claims, claim) endpoints. The single
 * source of truth is here so a schema change applies to all callers at once.
 *
 * Status includes 'claimed' (added in v010 migration) — that state represents
 * "employer has accepted responsibility for this job and is working on it".
 */
export const JobSchema = z.object({
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