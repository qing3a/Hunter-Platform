import { SHARED_CSS } from './shared-css.js';

export interface UserQuotaViewData {
  userId: string;
  userType: 'candidate' | 'hr' | 'pm';  // R1.C2: renamed from 'hr'/'pm'
  name: string;
  quotaPerDay: number;
  quotaUsed: number;
  quotaResetAt: string;
  rateLimits: { window: string; limit: number; used: number }[];
  recentActions: Array<{ at: string; action_type: string; status: string }>;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderUserQuota(d: UserQuotaViewData): string {
  const remaining = d.quotaPerDay - d.quotaUsed;
  const pct = d.quotaPerDay > 0 ? Math.round((d.quotaUsed / d.quotaPerDay) * 100) : 0;

  const rlRows = d.rateLimits.map((rl) => {
    const rPct = rl.limit > 0 ? Math.round((rl.used / rl.limit) * 100) : 0;
    return `<tr><td>${esc(rl.window)}</td><td>${rl.used}</td><td>${rl.limit}</td><td>${rPct}%</td></tr>`;
  }).join('');

  const actionRows = d.recentActions.slice(0, 10).map((a) =>
    `<tr><td>${esc(a.at)}</td><td>${esc(a.action_type)}</td><td>${esc(a.status)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>用户配额 — ${esc(d.name)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>用户配额</h1>
    <p class="meta"><code>${esc(d.userId)}</code> · ${esc(d.userType)} · ${esc(d.name)}</p>

    <div class="card">
      <h2>今日配额</h2>
      <dl class="kv">
        <dt>已使用</dt><dd>${d.quotaUsed} / ${d.quotaPerDay} (${pct}%)</dd>
        <dt>剩余</dt><dd>${remaining}</dd>
        <dt>重置时间</dt><dd>${esc(d.quotaResetAt)}</dd>
      </dl>
    </div>

    <div class="card">
      <h2>限流状态</h2>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="text-align:left; color:#718096; font-size:13px;">
          <th>窗口</th><th>已用</th><th>上限</th><th>占比</th>
        </tr></thead>
        <tbody>${rlRows || '<tr><td colspan="4" style="color:#a0aec0;">无数据</td></tr>'}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>最近活动</h2>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="text-align:left; color:#718096; font-size:13px;">
          <th>时间</th><th>动作</th><th>状态</th>
        </tr></thead>
        <tbody>${actionRows || '<tr><td colspan="3" style="color:#a0aec0;">无活动</td></tr>'}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}