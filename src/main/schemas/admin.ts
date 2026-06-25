import { z } from 'zod';
import { EnvelopeSchema, ISODateTime, IdString, UserPublicSchema } from './common.js';

const SuspendResultSchema = z.object({
  user_id: IdString,
  status: z.literal('suspended'),
  reason: z.string(),
});
const UnsuspendResultSchema = z.object({
  user_id: IdString,
  status: z.literal('active'),
});
const AdjustQuotaResultSchema = z.object({
  user_id: IdString,
  previous_quota: z.number().int(),
  new_quota: z.number().int(),
  reason: z.string(),
});

const AdminCandidateSchema = z.object({
  anonymized_id: IdString,
  candidate_user_id: IdString,
  headhunter_id: IdString,
  // PII-masked (see src/main/lib/mask.ts). Admin can drill into user details
  // via /v1/admin/users if they need the full name/email.
  masked_name: z.string(),
  masked_email: z.string(),
  industry: z.string().nullable(),
  title_level: z.string().nullable(),
  is_public_pool: z.union([z.literal(0), z.literal(1)]),
  unlock_status: z.string(),
  created_at: ISODateTime,
});

const AuditItemSchema = z.object({
  id: z.number().int(),
  recommendation_id: IdString.nullable(),
  actor_user_id: IdString.nullable(),
  action: z.string(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: ISODateTime,
});

const AdminActionHistoryItemSchema = z.object({
  id: z.number().int(),
  user_id: IdString,
  capability_name: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  request_summary_json: z.string().nullable(),
  response_summary_json: z.string().nullable(),
  status: z.enum(['success', 'error']),
  error_code: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  trace_id: z.string().nullable(),
  created_at: ISODateTime,
});

const AdminActionHistoryPaginationSchema = z.object({
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
});

const DeadLetterItemSchema = z.object({
  id: z.number().int(),
  target_user_id: IdString,
  event_type: z.string(),
  attempt_count: z.number().int(),
  last_error: z.string().nullable(),
  next_retry_at: ISODateTime.nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const RateLimitBucketSchema = z.object({
  user_id: IdString,
  bucket_key: z.string(),
  count: z.number().int(),
  window_started_at: ISODateTime,
});

const AdminPlacementSchema = z.object({
  id: IdString,
  job_id: IdString,
  employer_id: IdString,
  anonymized_candidate_id: IdString,
  primary_headhunter_id: IdString.nullable(),
  referrer_headhunter_id: IdString.nullable(),
  annual_salary: z.number().int(),
  platform_fee: z.number().int(),
  primary_share: z.number().int(),
  referrer_share: z.number().int(),
  status: z.enum(['pending_payment', 'paid', 'cancelled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const AdminLogItemSchema = z.object({
  id: z.number().int(),
  actor: z.string(),
  action_type: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  reason: z.string().nullable(),
  // Raw details_json envelope (e.g. { previous_quota, new_quota, reason }
  // for adjust-quota). Optional + nullable for backward compat with rows
  // that pre-date this field. admin-web AuditPage parses and displays it.
  details_json: z.string().nullable().optional(),
  created_at: ISODateTime,
});

const DashboardStatsSchema = z.object({
  total_users: z.number().int(),
  total_candidates: z.number().int(),
  total_jobs: z.number().int(),
  open_jobs: z.number().int(),
  active_placements: z.number().int(),
  daily_quota_used: z.number().int(),
  webhook_dead_letters: z.number().int(),
  // Sub-B additions: today new users + 30-day daily-new trend (oldest → newest)
  today_new_users: z.number().int(),
  trend_30d: z.array(z.number().int()).length(30),
  // Sub-C additions: jobs status detail + recommendations overview
  total_recommendations: z.number().int(),
  today_new_recommendations: z.number().int(),
  recommendations_pending: z.number().int(),
  recommendations_unlocked: z.number().int(),
  jobs_paused: z.number().int(),
  jobs_closed: z.number().int(),
  jobs_filled: z.number().int(),
});

const ConfigEntrySchema = z.record(z.string(), z.unknown());

const PlacementsSummarySchema = z.object({
  total_count: z.number().int(),
  pending_payment_count: z.number().int(),
  paid_count: z.number().int(),
  cancelled_count: z.number().int(),
  total_revenue: z.number().int(),
});

export const PingResponseSchema = EnvelopeSchema(
  z.object({ message: z.literal('admin pong') })
);
export const DashboardStatsResponseSchema = EnvelopeSchema(DashboardStatsSchema);
export const ListUsersResponseSchema = EnvelopeSchema(z.array(UserPublicSchema));
export const SuspendUserResponseSchema = EnvelopeSchema(SuspendResultSchema);
export const UnsuspendUserResponseSchema = EnvelopeSchema(UnsuspendResultSchema);
export const AdjustQuotaResponseSchema = EnvelopeSchema(AdjustQuotaResultSchema);
export const ListCandidatesResponseSchema = EnvelopeSchema(z.array(AdminCandidateSchema));
export const RemoveFromPoolResponseSchema = EnvelopeSchema(
  z.object({ anonymized_id: IdString, removed: z.literal(true) })
);
export const AuditListResponseSchema = EnvelopeSchema(z.array(AuditItemSchema));
export const DeadLetterListResponseSchema = EnvelopeSchema(z.array(DeadLetterItemSchema));
export const RetryWebhookResponseSchema = EnvelopeSchema(
  z.object({ id: z.number().int(), status: z.enum(['pending', 'in_flight']) })
);
export const RateLimitBucketsResponseSchema = EnvelopeSchema(z.array(RateLimitBucketSchema));
export const ClearRateLimitResponseSchema = EnvelopeSchema(
  z.object({ user_id: IdString, cleared: z.literal(true) })
);
export const ConfigGetResponseSchema = EnvelopeSchema(z.record(z.string(), z.unknown()));
export const ConfigPutResponseSchema = EnvelopeSchema(
  z.object({ key: z.string(), saved: z.literal(true) })
);
export const AdminPlacementsListResponseSchema = EnvelopeSchema(z.array(AdminPlacementSchema));
export const MarkPaidResponseSchema = EnvelopeSchema(
  z.object({ id: IdString, status: z.literal('paid') })
);
export const CancelPlacementResponseSchema = EnvelopeSchema(
  z.object({ id: IdString, status: z.literal('cancelled') })
);
export const PlacementsSummaryResponseSchema = EnvelopeSchema(PlacementsSummarySchema);
export const AdminLogListResponseSchema = EnvelopeSchema(z.array(AdminLogItemSchema));
export const ActionHistoryListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(AdminActionHistoryItemSchema),
  pagination: AdminActionHistoryPaginationSchema,
});

// Sub-B: shared pagination schema + paginated envelope for users/candidates list.
const PaginationSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  has_more: z.boolean(),
});

const ListUsersEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.array(UserPublicSchema),
  pagination: PaginationSchema,
});

// Sub-D1 regression fix: paginated envelope (matches users/candidates/jobs/
// recommendations pattern). Previously the route returned a flat array without
// pagination, which broke the frontend listAdminLog() helper (required env.pagination).
export const ListAdminLogResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(AdminLogItemSchema),
  pagination: PaginationSchema,
});

export { PaginationSchema, ListUsersEnvelopeSchema, ListTimelineResponseSchema, ListDeadLetterResponseSchema, ListPlacementsResponseSchema };

const DeadLetterRowSchema = z.object({
  id: z.number().int(),
  target_user_id: z.string(),
  event_type: z.string(),
  attempt_count: z.number().int(),
  last_error: z.string().nullable(),
  next_retry_at: z.string().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const ListDeadLetterResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(DeadLetterRowSchema),
  pagination: PaginationSchema,
});

const PlacementRowSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  employer_id: z.string(),
  anonymized_candidate_id: z.string(),
  primary_headhunter_id: z.string().nullable(),
  referrer_headhunter_id: z.string().nullable(),
  annual_salary: z.number(),
  platform_fee: z.number(),
  primary_share: z.number(),
  referrer_share: z.number(),
  status: z.enum(['pending_payment', 'paid', 'cancelled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const ListPlacementsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(PlacementRowSchema),
  pagination: PaginationSchema,
});

// Sub-D2: per-entity timeline schema. Standardized columns from 3 audit tables
// (admin_action_log + action_history + unlock_audit_log) via UNION ALL.
const TimelineItemSchema = z.object({
  id: z.number().int(),
  source: z.enum(['admin', 'user', 'unlock']),
  action: z.string(),
  actor: z.string().nullable(),
  details: z.string().nullable(),
  created_at: ISODateTime,
});

const ListTimelineResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(TimelineItemSchema),
  pagination: PaginationSchema,
});

// Sub-C Plan 1: Jobs + Recommendations list schemas
const JobRowSchema = z.object({
  id: IdString,
  employer_id: IdString,
  employer_name: z.string(),
  title: z.string(),
  status: z.enum(['open', 'claimed', 'paused', 'closed', 'filled']),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const RecommendationRowSchema = z.object({
  id: IdString,
  job_id: IdString,
  job_title: z.string(),
  anonymized_candidate_id: IdString,
  headhunter_id: IdString,
  headhunter_name: z.string(),
  status: z.enum([
    'pending', 'employer_interested', 'candidate_approved', 'unlocked',
    'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
  ]),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});

const ListJobsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(JobRowSchema),
  pagination: PaginationSchema,
});

const ListRecommendationsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(RecommendationRowSchema),
  pagination: PaginationSchema,
});

export {
  JobRowSchema, RecommendationRowSchema, AdminCandidateSchema,
  ListJobsResponseSchema, ListRecommendationsResponseSchema,
};

// Sub-D1: admin_login_events list schema
const AdminLoginEventSchema = z.object({
  id: z.number().int(),
  admin_user_id: z.string().nullable(),
  email: z.string(),
  success: z.union([z.literal(0), z.literal(1)]),
  failure_reason: z.string().nullable(),
  ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: ISODateTime,
});

export const LoginEventsListResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(AdminLoginEventSchema),
  pagination: PaginationSchema,
});

const ListCandidatesEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.array(AdminCandidateSchema),
  pagination: PaginationSchema,
});

export { ListCandidatesEnvelopeSchema };

// Admin auth (Sub-A of Task #3): login / me / rotate-key schemas.
// See docs/superpowers/specs/2026-06-23-web-admin-sub-A-design.md §2.
const AdminLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AdminLoginResponseSchema = EnvelopeSchema(
  z.object({
    admin_user_id: IdString,
    name: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'super']),
    api_key: z.string(),
  })
);

const AdminMeResponseSchema = EnvelopeSchema(
  z.object({
    id: IdString,
    name: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'super']),
    status: z.enum(['active', 'suspended']),
    last_login_at: ISODateTime.nullable(),
    created_at: ISODateTime,
  })
);

const AdminRotateKeyResponseSchema = EnvelopeSchema(
  z.object({
    api_key: z.string(),
  })
);

export {
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminMeResponseSchema,
  AdminRotateKeyResponseSchema,
};