import { SHARED_CSS } from './shared-css.js';

export interface AuditEntry {
  at: string;
  action_type: string;
  method: string | null;
  path: string | null;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
}

export interface AuditViewData {
  userId: string;
  entries: AuditEntry[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderAudit(d: AuditViewData): string {
  const rows = d.entries.slice(0, 50).map((e) => {
    const status = e.status_code ?? '—';
    const err = e.error_code ? ` <span style="color:#c53030">(${esc(e.error_code)})</span>` : '';
    const dur = e.duration_ms !== null ? `${e.duration_ms}ms` : '—';
    return `<tr>
      <td>${esc(e.at)}</td>
      <td><code>${esc(e.method ?? '—')}</code></td>
      <td><code>${esc(e.path ?? '—')}</code></td>
      <td>${esc(e.action_type)}</td>
      <td>${status}${err}</td>
      <td>${dur}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>审计日志 — ${esc(d.userId)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>审计日志</h1>
    <p class="meta">用户: <code>${esc(d.userId)}</code> · 最近 50 条</p>

    <div class="card">
      <table style="width:100%; border-collapse: collapse; font-size: 13px;">
        <thead><tr style="text-align:left; color:#718096;">
          <th>时间</th><th>方法</th><th>路径</th><th>动作</th><th>状态</th><th>耗时</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="color:#a0aec0;">无记录</td></tr>'}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}