// src/shared/types.ts
export type UserType = 'candidate' | 'headhunter' | 'employer';

export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface User {
  id: string;
  user_type: UserType;
  name: string;
  contact: string | null;
  agent_endpoint: string | null;
  api_key_hash: string;
  api_key_prefix: string;
  /**
   * When the current api_key_hash stops being accepted. NULL = never expires.
   * Set during rotate-key (now + 24h for the OLD key); the new key is
   * written with expires_at = NULL.
   */
  api_key_expires_at: string | null;
  /**
   * Grace-period slot for the previous (rotated-out) API key. After rotate-key,
   * the OLD hash is moved here with prev_api_key_expires_at = now + 24h.
   * NULL means no grace key. Auth middleware accepts this slot if
   * prev_api_key_expires_at > now.
   */
  prev_api_key_hash: string | null;
  prev_api_key_prefix: string | null;
  prev_api_key_expires_at: string | null;
  quota_per_day: number;
  quota_used: number;
  quota_reset_at: string;
  reputation: number;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INVALID_STATE'
  | 'DUPLICATE_REQUEST'
  | 'CONTACT_TAKEN'
  | 'INSUFFICIENT_QUOTA'
  | 'RATE_LIMITED'
  | 'INVALID_CHARSET'
  | 'INVALID_CONTENT_TYPE'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export interface AnonymizedCandidate {
  /** Optional: present on persisted candidates, absent on freshly-desensitized pre-insert values. */
  anonymized_id?: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}

// ============================================================
// M2: Jobs, Recommendations, Webhooks
// ============================================================

export type JobStatus = 'open' | 'claimed' | 'paused' | 'closed' | 'filled';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Job {
  id: string;
  employer_id: string | null;
  source_headhunter_id: string | null;
  created_for_employer_id: string | null;
  title: string;
  description: string | null;
  required_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  status: JobStatus;
  priority: JobPriority;
  deadline: string | null;
  industry: string | null;
  created_at: string;
  updated_at: string;
}

export type RecStatus =
  | 'pending'
  | 'employer_interested'
  | 'candidate_approved'
  | 'unlocked'
  | 'rejected_employer'
  | 'rejected_candidate'
  | 'withdrawn'
  | 'placed';

export interface Recommendation {
  id: string;
  headhunter_id: string;
  employer_id: string;
  anonymized_candidate_id: string;
  job_id: string;
  status: RecStatus;
  commission_split_json: string | null;
  referrer_headhunter_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationWithCandidate extends Recommendation {
  candidate: AnonymizedCandidate;
}

export type WebhookEventType =
  | 'notify_unlock_request'
  | 'notify_unlock_approved'
  | 'unlock_approved_by_candidate'
  | 'deliver_contact'
  | 'placement_created'
  | 'quota_warning';

export interface WebhookEvent {
  type: WebhookEventType;
  payload: Record<string, unknown>;
  contains_pii: boolean;
}

export type WebhookDeliveryStatus = 'pending' | 'in_flight' | 'success' | 'failed' | 'dead_letter';

export interface WebhookDeliveryRecord {
  id: number;
  target_user_id: string;
  event_type: WebhookEventType;
  payload_enc: string;
  contains_pii: number;
  status: WebhookDeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  delivered_at: string | null;
  /** W3C `traceparent` to propagate as outbound header (v012). NULL if no trace active at enqueue time. */
  traceparent: string | null;
  created_at: string;
  updated_at: string;
}
