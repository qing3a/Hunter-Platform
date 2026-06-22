// 静态路由 → action_type 映射表
// 顺序：精确匹配优先，否则 longest-prefix 匹配，否则 fallback
//
// 维护原则：
// - 每加一条新业务路由，必须同时在这里加一条 ROUTES 记录。
// - 未列在 ROUTES 里的路由会走 fallback（资源级 unknown_<method>_<resource>），
//   不再展开完整路径（避免审计日志里出现 `unknown_get_v1_employer_placements`
//   这种难以聚合的字符串）。
// - 路径用 Express 风格：`:id` 表示单段参数。

interface RoutePattern {
  method: string;
  /** Express-style: `:id` for single-segment param, `*` for trailing wildcard. */
  pattern: string;
  action_type: string;
}

/** Canonical list of every action_type that audit logs may emit.
 *  Values are the same canonical capability names that the middleware now
 *  writes to `action_history.capability_name` after the v013 migration. */
export const ACTION_TYPES = [
  // Auth
  'auth.register',
  'auth.rotate_key',
  // Headhunter
  'headhunter.upload_candidate',
  'headhunter.list_candidates',
  'headhunter.publish_to_pool',
  'headhunter.recommend_candidate',
  'headhunter.list_recommendations',
  'headhunter.withdraw_recommendation',
  // Headhunter jobs
  'headhunter.create_job',
  'headhunter.list_jobs',
  // Employer
  'employer.create_job',
  'employer.list_jobs',
  'employer.talent',
  'employer.express_interest',
  'employer.unlock_contact',
  'employer.create_placement',
  'employer.list_placements',
  // Candidate
  'candidate.opportunities',
  'candidate.access_log',
  'candidate.approve_unlock',
  'candidate.reject_unlock',
  'candidate.export_my_data',
  'candidate.delete_my_data',
  // User
  'users.get_status',
  'users.get_history',
  // Config / market (read-only, but still audited for usage)
  'config.get_industries',
  'config.get_title_levels',
  'config.get_salary_bands',
  'market.leaderboard',
] as const;
export type ActionType = typeof ACTION_TYPES[number];

const ROUTES: RoutePattern[] = [
  // ---------- Auth ----------
  { method: 'POST', pattern: '/v1/auth/register',           action_type: 'auth.register' },
  { method: 'POST', pattern: '/v1/auth/rotate-key',         action_type: 'auth.rotate_key' },

  // ---------- Headhunter ----------
  { method: 'POST', pattern: '/v1/headhunter/candidates',                     action_type: 'headhunter.upload_candidate' },
  { method: 'GET',  pattern: '/v1/headhunter/candidates',                     action_type: 'headhunter.list_candidates' },
  { method: 'POST', pattern: '/v1/headhunter/candidates/:id/publish',         action_type: 'headhunter.publish_to_pool' },
  { method: 'POST', pattern: '/v1/headhunter/candidates/:id/publish-to-pool', action_type: 'headhunter.publish_to_pool' },
  { method: 'POST', pattern: '/v1/headhunter/recommendations',                action_type: 'headhunter.recommend_candidate' },
  { method: 'GET',  pattern: '/v1/headhunter/recommendations',                action_type: 'headhunter.list_recommendations' },
  { method: 'POST', pattern: '/v1/headhunter/recommendations/:id/withdraw',   action_type: 'headhunter.withdraw_recommendation' },

  // ---------- Employer ----------
  { method: 'POST', pattern: '/v1/employer/jobs',                              action_type: 'employer.create_job' },
  { method: 'GET',  pattern: '/v1/employer/jobs',                              action_type: 'employer.list_jobs' },
  { method: 'GET',  pattern: '/v1/employer/talent',                            action_type: 'employer.talent' },
  { method: 'POST', pattern: '/v1/employer/recommendations/:id/express-interest', action_type: 'employer.express_interest' },
  { method: 'POST', pattern: '/v1/employer/recommendations/:id/unlock-contact',  action_type: 'employer.unlock_contact' },
  { method: 'POST', pattern: '/v1/employer/placements',                        action_type: 'employer.create_placement' },
  { method: 'GET',  pattern: '/v1/employer/placements',                        action_type: 'employer.list_placements' },

  // ---------- Candidate ----------
  { method: 'GET',  pattern: '/v1/candidate/opportunities',                    action_type: 'candidate.opportunities' },
  { method: 'GET',  pattern: '/v1/candidate/access-log',                       action_type: 'candidate.access_log' },
  { method: 'POST', pattern: '/v1/candidate/recommendations/:id/approve-unlock', action_type: 'candidate.approve_unlock' },
  { method: 'POST', pattern: '/v1/candidate/recommendations/:id/reject-unlock',  action_type: 'candidate.reject_unlock' },
  { method: 'GET',  pattern: '/v1/candidate/export-my-data',                   action_type: 'candidate.export_my_data' },
  { method: 'POST', pattern: '/v1/candidate/delete-my-data',                   action_type: 'candidate.delete_my_data' },

  // ---------- User ----------
  { method: 'GET',  pattern: '/v1/users/:id/status',   action_type: 'users.get_status' },
  { method: 'GET',  pattern: '/v1/users/:id/history',  action_type: 'users.get_history' },

  // ---------- Config / market (optional-auth) ----------
  { method: 'GET',  pattern: '/v1/config/industries',   action_type: 'config.get_industries' },
  { method: 'GET',  pattern: '/v1/config/title_levels', action_type: 'config.get_title_levels' },
  { method: 'GET',  pattern: '/v1/config/salary_bands', action_type: 'config.get_salary_bands' },
  { method: 'GET',  pattern: '/v1/market/leaderboard',  action_type: 'market.leaderboard' },
];

function matchPattern(pattern: string, actual: string): boolean {
  const pp = pattern.split('/');
  const ap = actual.split('/');
  if (pp.length !== ap.length) return false;
  for (let i = 0; i < pp.length; i++) {
    const pSeg = pp[i];
    const aSeg = ap[i];
    if (pSeg === undefined || aSeg === undefined) return false;
    if (pSeg.startsWith(':')) continue;  // 参数段
    if (pSeg !== aSeg) return false;
  }
  return true;
}

/**
 * Resource name extracted from the last non-param path segment of `path`.
 *
 * Examples:
 *   /v1/employer/placements              → "placements"
 *   /v1/headhunter/recommendations/abc/withdraw → "withdraw"
 *   /v1/users/abc/history                → "history"
 *   /                                    → "root"
 *
 * Used by the fallback to produce `unknown_<method>_<resource>` — much more
 * aggregable than the previous `unknown_<method>_<full_normalized_path>`.
 */
function lastResourceSegment(path: string): string {
  const segs = path.split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (seg && !seg.startsWith(':') && !/^v\d+$/.test(seg)) return seg;
  }
  return 'root';
}

export function lookupActionType(method: string, path: string): string {
  for (const r of ROUTES) {
    if (r.method === method && matchPattern(r.pattern, path)) return r.action_type;
  }
  // Fallback: keep just the last resource segment, not the full normalized path.
  // This makes `unknown_<method>_<resource>` groupable in metrics dashboards.
  return `unknown_${method.toLowerCase()}_${lastResourceSegment(path)}`;
}