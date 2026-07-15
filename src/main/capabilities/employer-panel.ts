import { defineCapabilitySet } from './types.js';

/**
 * PM Panel (Phase 3c) — 雇主浏览器面板首页聚合.
 * 路由: GET /v1/employer-panel/dashboard
 *
 * 一发到位的 7 项聚合 (active_jobs / open_positions / candidates_viewed_this_month
 * / interested_count / unlocked_count / placements_count / spend_this_month)。
 * role 'pm' — 同一 prefix 三处 (pm/employer/employer-panel) 共用 pm role。
 */
export const employerPanelCapabilities = defineCapabilitySet({
  role: 'pm',
  capabilities: [
    {
      name: 'employer_panel.dashboard',
      description: '雇主浏览器面板首页 7 项聚合 (active_jobs / open_positions / candidates_viewed_this_month / interested_count / unlocked_count / placements_count / spend_this_month)。',
      method: 'GET', path: '/v1/employer-panel/dashboard',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.employer_dashboard.aggregate'],
    },
  ],
});
