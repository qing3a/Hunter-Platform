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

/** Canonical list of every action_type that audit logs may emit. */
export const ACTION_TYPES = [
  // Auth
  'register',
  'rotate_api_key',
  // Headhunter
  'upload_candidate',
  'list_my_candidates',
  'publish_to_pool',
  'recommend_candidate',
  'list_my_recommendations',
  'withdraw_recommendation',
  // Employer
  'create_job',
  'list_my_jobs',
  'browse_talent',
  'express_interest',
  'unlock_contact',
  'create_placement',
  'list_my_placements',
  // Candidate
  'list_opportunities',
  'view_access_log',
  'approve_unlock',
  'reject_unlock',
  'export_my_data',
  'delete_my_data',
  // User
  'get_user_status',
  'get_user_history',
  // Config / market (read-only, but still audited for usage)
  'get_config_industries',
  'get_config_title_levels',
  'get_config_salary_bands',
  'get_market_leaderboard',
] as const;
export type ActionType = typeof ACTION_TYPES[number];

const ROUTES: RoutePattern[] = [
  // ---------- Auth ----------
  { method: 'POST', pattern: '/v1/auth/register',           action_type: 'register' },
  { method: 'POST', pattern: '/v1/auth/rotate-key',         action_type: 'rotate_api_key' },

  // ---------- Headhunter ----------
  { method: 'POST', pattern: '/v1/headhunter/candidates',                     action_type: 'upload_candidate' },
  { method: 'GET',  pattern: '/v1/headhunter/candidates',                     action_type: 'list_my_candidates' },
  { method: 'POST', pattern: '/v1/headhunter/candidates/:id/publish',         action_type: 'publish_to_pool' },
  { method: 'POST', pattern: '/v1/headhunter/candidates/:id/publish-to-pool', action_type: 'publish_to_pool' },
  { method: 'POST', pattern: '/v1/headhunter/recommendations',                action_type: 'recommend_candidate' },
  { method: 'GET',  pattern: '/v1/headhunter/recommendations',                action_type: 'list_my_recommendations' },
  { method: 'POST', pattern: '/v1/headhunter/recommendations/:id/withdraw',   action_type: 'withdraw_recommendation' },

  // ---------- Employer ----------
  { method: 'POST', pattern: '/v1/employer/jobs',                              action_type: 'create_job' },
  { method: 'GET',  pattern: '/v1/employer/jobs',                              action_type: 'list_my_jobs' },
  { method: 'GET',  pattern: '/v1/employer/talent',                            action_type: 'browse_talent' },
  { method: 'POST', pattern: '/v1/employer/recommendations/:id/express-interest', action_type: 'express_interest' },
  { method: 'POST', pattern: '/v1/employer/recommendations/:id/unlock-contact',  action_type: 'unlock_contact' },
  { method: 'POST', pattern: '/v1/employer/placements',                        action_type: 'create_placement' },
  { method: 'GET',  pattern: '/v1/employer/placements',                        action_type: 'list_my_placements' },

  // ---------- Candidate ----------
  { method: 'GET',  pattern: '/v1/candidate/opportunities',                    action_type: 'list_opportunities' },
  { method: 'GET',  pattern: '/v1/candidate/access-log',                       action_type: 'view_access_log' },
  { method: 'POST', pattern: '/v1/candidate/recommendations/:id/approve-unlock', action_type: 'approve_unlock' },
  { method: 'POST', pattern: '/v1/candidate/recommendations/:id/reject-unlock',  action_type: 'reject_unlock' },
  { method: 'GET',  pattern: '/v1/candidate/export-my-data',                   action_type: 'export_my_data' },
  { method: 'POST', pattern: '/v1/candidate/delete-my-data',                   action_type: 'delete_my_data' },

  // ---------- User ----------
  { method: 'GET',  pattern: '/v1/users/:id/status',   action_type: 'get_user_status' },
  { method: 'GET',  pattern: '/v1/users/:id/history',  action_type: 'get_user_history' },

  // ---------- Config / market (optional-auth) ----------
  { method: 'GET',  pattern: '/v1/config/industries',   action_type: 'get_config_industries' },
  { method: 'GET',  pattern: '/v1/config/title_levels', action_type: 'get_config_title_levels' },
  { method: 'GET',  pattern: '/v1/config/salary_bands', action_type: 'get_config_salary_bands' },
  { method: 'GET',  pattern: '/v1/market/leaderboard',  action_type: 'get_market_leaderboard' },
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