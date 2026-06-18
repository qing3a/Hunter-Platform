import { SHARED_CSS } from './shared-css.js';

export interface UserCounts { candidate: number; headhunter: number; employer: number; }
export interface CandidateCounts { total: number; publicPool: number; }
export interface RecommendationCounts { [status: string]: number; }
export interface EndpointCounts { [actionType: string]: number; }
export interface RecentActivity {
  at: string;
  action_type: string;
  status: string;
}

export interface DashboardData {
  users: UserCounts;
  candidates: CandidateCounts;
  recommendations: RecommendationCounts;
  totalRecommendations: number;
  endpointsToday: EndpointCounts;
  totalEndpointsToday: number;
  recentActivity: RecentActivity[];
  serverTime: string;
  uptimeHours: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const RECOMMENDATION_STATUSES = [
  'pending', 'employer_interested', 'candidate_approved', 'unlocked', 'placed',
  'rejected_employer', 'rejected_candidate', 'withdrawn',
];

export function renderDashboard(d: DashboardData): string {
  const totalUsers = d.users.candidate + d.users.headhunter + d.users.employer;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Hunter Platform · Operations Dashboard</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>Hunter Platform · Operations Dashboard</h1>
    <p class="meta">🟢 Healthy · ${esc(d.serverTime)} UTC · uptime ${d.uptimeHours.toFixed(1)}h</p>

    <div class="card">
      <h2>Users &amp; Candidates</h2>
      <dl class="kv">
        <dt>Total users</dt><dd>${totalUsers}</dd>
        <dt>├─ candidate</dt><dd>${d.users.candidate}</dd>
        <dt>├─ headhunter</dt><dd>${d.users.headhunter}</dd>
        <dt>└─ employer</dt><dd>${d.users.employer}</dd>
        <dt>Anonymized candidates</dt><dd>${d.candidates.total}</dd>
        <dt>├─ Public pool</dt><dd>${d.candidates.publicPool}</dd>
      </dl>
    </div>

    <div class="card">
      <h2>Recommendation Pipeline</h2>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="text-align:left; color:#718096; font-size:13px;">
          <th>Status</th><th>Count</th>
        </tr></thead>
        <tbody>
          ${RECOMMENDATION_STATUSES.map(s => `
            <tr>
              <td>${esc(s)}</td>
              <td>${d.recommendations[s] ?? 0}</td>
            </tr>`).join('')}
          <tr style="border-top: 2px solid #e2e8f0; font-weight: bold;">
            <td>Total</td><td>${d.totalRecommendations}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>API Calls Today</h2>
      <dl class="kv">
        <dt>Total</dt><dd>${d.totalEndpointsToday}</dd>
      </dl>
      ${Object.keys(d.endpointsToday).length === 0
        ? '<p class="meta">No calls today yet.</p>'
        : `<table style="width:100%; border-collapse: collapse; margin-top: 8px;">
            <thead><tr style="text-align:left; color:#718096; font-size:13px;">
              <th>Action</th><th>Count</th>
            </tr></thead>
            <tbody>
              ${Object.entries(d.endpointsToday)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => `<tr><td><code>${esc(action)}</code></td><td>${count}</td></tr>`)
                .join('')}
            </tbody>
          </table>`}
    </div>

    <div class="card">
      <h2>Recent Activity (last 20)</h2>
      ${d.recentActivity.length === 0
        ? '<p class="meta">No activity yet.</p>'
        : `<table style="width:100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="text-align:left; color:#718096;">
              <th>Time</th><th>Action</th><th>Status</th>
            </tr></thead>
            <tbody>
              ${d.recentActivity.map(a => `
                <tr>
                  <td>${esc(a.at.split('T')[1]?.slice(0, 8) ?? a.at)}</td>
                  <td><code>${esc(a.action_type)}</code></td>
                  <td>${esc(a.status)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          <p class="meta">匿名 feed：不含 user_id / target_id</p>`}
    </div>
  </main>
</body>
</html>`;
}