// src/shared/constants.ts
export const QUOTA_PER_DAY = {
  candidate: 50,
  headhunter: 200,
  employer: 100,
} as const;

export const RATE_LIMIT_BURSTS = {
  candidate:  { second: 10, minute: 50,  hour: 300 },
  headhunter: { second: 20, minute: 100, hour: 750 },
  employer:   { second: 30, minute: 200, hour: 1200 },
} as const;

/** Trigger soft warning when remaining / limit falls below this ratio. */
export const RATE_LIMIT_SOFT_WARN_RATIO = 0.20;

/** Algorithm version. 1 = fixed-window (deprecated, kept for rollback), 2 = sliding-window-counter. */
export const RATE_LIMIT_ALGO_VERSION = 2;

export const QUOTA_COSTS = {
  register: 0,
  upload_candidate: 5,
  // M2:
  create_job: 5,
  browse_talent: 1,
  browse_jobs: 1,  // v1.3: GET /v1/market/jobs
  express_interest: 3,
  unlock_contact: 5,
  recommend_candidate: 5,
  withdraw_recommendation: 1,
  publish_to_pool: 2,
  view_opportunities: 1,
  approve_unlock: 3,
  reject_unlock: 1,
  list_recommendations: 1,
  list_my_jobs: 1,
  config_lookup: 1,
  list_my_candidates: 1,
} as const;

export const WEBHOOK_DELIVERY_TIMEOUT_MS = 5000;
export const WEBHOOK_RETRY_DELAYS_SECONDS = [1, 4, 16] as const;
export const RECOMMENDATION_DEFAULT_COMMISSION_SPLIT = { hunter: 1.0, referrer: 0 };

export const MAX_BODY_SIZE = '4kb';
/** express.json() body size limit for routes that accept long job descriptions (5000 UTF-8 chars ≈ 15KB). */
export const BODY_LIMIT_LARGE = '64kb';
export const IDEMPOTENCY_TTL_HOURS = 24;
export const API_KEY_PREFIX_LENGTH = 12;  // ⚠️ 必须 ≥ 12 才能用于 auth bucketing（8 字符全相同）
export const RATE_LIMIT_WINDOW_SECONDS = [1, 60, 3600] as const;
