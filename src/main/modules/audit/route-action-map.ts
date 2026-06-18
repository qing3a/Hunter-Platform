// 静态路由 → action_type 映射表
// 顺序：精确匹配优先，否则 longest-prefix 匹配，否则 fallback

interface RoutePattern {
  method: string;
  // Express-style: :id 表示单段参数，* 表示尾段任意
  pattern: string;
  action_type: string;
}

const ROUTES: RoutePattern[] = [
  { method: 'POST',   pattern: '/v1/auth/register',                                       action_type: 'register' },
  { method: 'POST',   pattern: '/v1/headhunter/candidates',                               action_type: 'upload_candidate' },
  { method: 'POST',   pattern: '/v1/headhunter/candidates/:id/publish',                  action_type: 'publish_to_pool' },
  { method: 'POST',   pattern: '/v1/headhunter/candidates/:id/publish-to-pool',          action_type: 'publish_to_pool' },
  { method: 'POST',   pattern: '/v1/headhunter/recommendations',                         action_type: 'recommend_candidate' },
  { method: 'DELETE', pattern: '/v1/headhunter/recommendations/:id',                      action_type: 'withdraw_recommendation' },
  { method: 'POST',   pattern: '/v1/headhunter/recommendations/:id/withdraw',            action_type: 'withdraw_recommendation' },
  { method: 'GET',    pattern: '/v1/headhunter/recommendations',                         action_type: 'list_recommendations' },
  { method: 'POST',   pattern: '/v1/employer/jobs',                                       action_type: 'create_job' },
  { method: 'GET',    pattern: '/v1/employer/talent',                                     action_type: 'browse_talent' },
  { method: 'POST',   pattern: '/v1/employer/recommendations/:id/interest',              action_type: 'express_interest' },
  { method: 'POST',   pattern: '/v1/employer/recommendations/:id/express-interest',      action_type: 'express_interest' },
  { method: 'POST',   pattern: '/v1/employer/recommendations/:id/unlock',                action_type: 'unlock_contact' },
  { method: 'POST',   pattern: '/v1/employer/recommendations/:id/unlock-contact',         action_type: 'unlock_contact' },
  { method: 'POST',   pattern: '/v1/candidate/export',                                    action_type: 'export_data' },
  { method: 'GET',    pattern: '/v1/candidate/export-my-data',                            action_type: 'export_data' },
  { method: 'GET',    pattern: '/v1/candidate/access-log',                                action_type: 'view_access_log' },
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

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\//g, '_').replace(/[^a-z0-9_]/gi, '');
}

export function lookupActionType(method: string, path: string): string {
  for (const r of ROUTES) {
    if (r.method === method && matchPattern(r.pattern, path)) return r.action_type;
  }
  return `unknown_${method.toLowerCase()}_${normalizePath(path) || 'root'}`;
}