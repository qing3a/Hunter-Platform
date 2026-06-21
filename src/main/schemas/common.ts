import { z } from 'zod';

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