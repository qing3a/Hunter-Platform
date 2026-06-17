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
  | 'INSUFFICIENT_QUOTA'
  | 'RATE_LIMITED'
  | 'INVALID_STATE'
  | 'DUPLICATE_REQUEST'
  | 'INTERNAL_ERROR';

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };

export interface AnonymizedCandidate {
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}
