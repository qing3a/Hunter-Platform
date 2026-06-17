// src/shared/constants.ts
export const QUOTA_PER_DAY = {
  candidate: 50,
  headhunter: 200,
  employer: 100,
} as const;

export const RATE_LIMIT_BURSTS = {
  candidate:  { second: 10, minute: 50,  hour: 200 },
  headhunter: { second: 20, minute: 100, hour: 500 },
  employer:   { second: 30, minute: 200, hour: 800 },
} as const;

export const QUOTA_COSTS = {
  register: 0,
  upload_candidate: 5,
  // M2+:
  // create_job: 5,
  // browse_talent: 1,
  // express_interest: 3,
  // recommend_candidate: 5,
  // approve_unlock: 3,
} as const;

export const MAX_BODY_SIZE = '4kb';
export const IDEMPOTENCY_TTL_HOURS = 24;
export const API_KEY_PREFIX_LENGTH = 12;  // ⚠️ 必须 ≥ 12 才能用于 auth bucketing（8 字符全相同）
export const RATE_LIMIT_WINDOW_SECONDS = [1, 60, 3600] as const;
