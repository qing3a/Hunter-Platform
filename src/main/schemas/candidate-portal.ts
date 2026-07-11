import { z } from 'zod';

// Candidate Portal Phase 1 — consolidated Zod request/response schemas.
//
// This file is the single source of truth for the wire shape of every
// `/v1/candidate-portal/*` endpoint. The router layer (`routes/candidate-portal.ts`)
// imports these and calls `respond()` with them; the handler modules
// (`modules/candidate-portal/*.ts`) return plain JS objects matching these shapes.
//
// Conventions:
//   - Request bodies use `.strict()` so unknown keys cause a 400 (loud rejection).
//   - Response envelopes are bare `z.object({ ok: z.literal(true), data: ... })`
//     — `respond()` does its own validation; we don't wrap with `EnvelopeSchema()`
//     so the helper can pass a single schema to `safeParse`.
//   - `next_cursor` is null (not undefined) when pagination ends, per OpenAPI.
//   - All enums use `z.enum([...])` — strings from clients must match exactly.

// ===== Auth =====

/**
 * User-type discriminator accepted by the OTP endpoints. Phase 3a (Task 11)
 * added `headhunter` so the hunter portal can reuse the same OTP endpoints.
 * Phase 3b (PM Workbench / Task 1b) adds `pm` for the /pm/* portal.
 * `employer` is intentionally absent because the employer portal uses a
 * separate auth path.
 */
const UserTypeSchema = z.enum(['candidate', 'hr', 'pm']);

/** POST /v1/candidate-portal/auth/otp/request */
export const OtpRequestSchema = z.object({
  email: z.string().email(),
  user_type: UserTypeSchema.optional(),
}).strict();

export const OtpRequestResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    // 0 is valid in test mode (e.g. otpTtlSeconds=0 means the OTP is
    // immediately expired on next verify). Production env constrains TTL to
    // 60-3600s via zod in env.ts so 0 only appears in tests.
    expires_in: z.number().int().nonnegative(),
    dev_code: z.string().optional(),
  }),
}).strict();

/** POST /v1/candidate-portal/auth/otp/verify */
export const OtpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
  user_type: UserTypeSchema.optional(),
}).strict();

export const OtpVerifyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    api_key: z.string().regex(/^hp_live_/),
    user_id: z.string().min(1),
    profile_complete: z.boolean(),
    /** Echo of the resolved user_type so the client can pick the right portal. */
    user_type: UserTypeSchema,
  }),
}).strict();

// ===== Jobs =====

const JobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  industry: z.string().nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  skills: z.array(z.string()),
  priority: z.string(),
  posted_at: z.string(),
  employer_id: z.string().nullable().optional(),
});

/** GET /v1/candidate-portal/jobs/browse */
export const JobsBrowseResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(JobSummarySchema),
    next_cursor: z.number().nullable(),
  }),
}).strict();

/** GET /v1/candidate-portal/jobs/recommended */
export const RecommendedJobsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(z.object({
    job_id: z.string(),
    score: z.number(),
  })),
}).strict();

/** GET /v1/candidate-portal/jobs/:id */
export const JobDetailResponseSchema = z.object({
  ok: z.literal(true),
  data: JobSummarySchema.extend({
    description: z.string().nullable().optional(),
    match_score: z.number(),
    match_dimensions: z.object({
      skills: z.array(z.string()),
      job_skills: z.array(z.string()),
    }),
  }),
}).strict();

// ===== Applications =====

/** POST /v1/candidate-portal/jobs/:id/apply */
export const ApplySchema = z.object({
  note: z.string().max(500).optional(),
}).strict();

export const ApplyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    application_id: z.number(),
    recommendation_id: z.string(),
  }),
}).strict();

/** GET /v1/candidate-portal/applications (and detail, audit-log) */
export const ApplicationsListResponseSchema = z.object({
  ok: z.literal(true),
  // Tightened in Task 12 to concrete ApplicationListItem / ApplicationRow /
  // CandidateAuditEntry shapes. z.any() here preserves the existing payload
  // through the router→handler→client pipeline without losing data while
  // the schema contract is being finalized.
  data: z.any(),
}).strict();

/** POST /v1/candidate-portal/applications/:id/respond */
export const RespondSchema = z.object({
  action: z.enum(['withdraw', 'consider_offer', 'accept_offer', 'decline_offer']),
}).strict();

export const RespondResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ status: z.string() }),
}).strict();

// ===== Profile =====

/** GET /v1/candidate-portal/profile */
export const ProfileViewResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    industry: z.string().nullable(),
    title_level: z.string().nullable(),
    years_experience: z.number().nullable(),
    skills: z.array(z.string()),
    visibility: z.string(),
    expectations: z.any().nullable(),
    pii: z.object({
      name: z.string().nullable(),
      current_company: z.string().nullable(),
      education_tier: z.string().nullable(),
    }),
  }),
}).strict();

/** PUT /v1/candidate-portal/profile */
export const ProfileUpdateSchema = z.object({
  skills: z.array(z.string()).optional(),
  expectations: z.record(z.any()).optional(),
  visibility: z.enum(['public', 'invitation_only', 'hidden']).optional(),
}).strict();

export const ProfileUpdateResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ updated: z.boolean() }),
}).strict();

// ===== Messages =====

/** POST /v1/candidate-portal/messages */
export const MessageSendSchema = z.object({
  to_user_id: z.string(),
  content: z.string().min(1).max(2000),
  application_id: z.number().int().optional(),
}).strict();

export const MessageSendResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ message_id: z.number() }),
}).strict();

/** GET /v1/candidate-portal/messages */
export const MessagesListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    // Tightened in Task 12.
    items: z.array(z.any()),
    unread_count: z.number(),
    box: z.enum(['inbox', 'sent']),
  }),
}).strict();

// ===== Pickup (headhunter-side; same router to keep Phase 1 self-contained) =====

/** GET /v1/candidate-portal/pickup */
export const PendingPickupResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    items: z.array(z.any()),
    next_cursor: z.number().nullable(),
  }),
}).strict();

/** POST /v1/candidate-portal/pickup/:recommendationId */
export const PickupResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    recommendation_id: z.string(),
    status: z.string(),
  }),
}).strict();