// src/main/modules/view/templates/landing/stats.ts
// A1 fix: cold-start zeros render as honest "—" placeholders with "等待中" label suffix,
// instead of large bold "0" that imply an active metric. Uptime is a real number
// driven by process.uptime() in gather-landing-data.ts.
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

function emptyStat(icon: string, label: string): string {
  return html`
    <div class="stat">
      <div class="stat-icon">${icon}</div>
      <div class="stat-value stat-empty">—</div>
      <div class="stat-label">${label}<span class="stat-label-sub"> · 等待中</span></div>
    </div>
  `;
}

function liveStat(icon: string, value: number, label: string): string {
  return html`
    <div class="stat">
      <div class="stat-icon">${icon}</div>
      <div class="stat-value" data-target="${value}">${value}</div>
      <div class="stat-label">${label}</div>
    </div>
  `;
}

function formatUptime(sec: number): string {
  if (sec < 60) return `启动 ${sec}s`;
  if (sec < 3600) return `运行 ${Math.floor(sec / 60)} 分钟`;
  if (sec < 86400) return `运行 ${Math.floor(sec / 3600)} 小时`;
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  return `运行 ${days} 天 ${hours} 小时`;
}

export function stats(data: LandingData): string {
  const uptimeHint = formatUptime(data.uptimeSec);

  return html`
<div class="card hero-stats">
  <div class="stats-grid">
    ${data.todayUnlocks === 0
      ? emptyStat('🔓', '今日解锁')
      : liveStat('🔓', data.todayUnlocks, '今日解锁')}
    ${data.todayPlacements === 0
      ? emptyStat('🎯', '今日 placements')
      : liveStat('🎯', data.todayPlacements, '今日 placements')}
    ${data.totalCandidates === 0
      ? emptyStat('👥', '活跃候选人')
      : liveStat('👥', data.totalCandidates, '活跃候选人')}
    <div class="stat">
      <div class="stat-icon">⚡</div>
      <div class="stat-value">${data.uptimePercent}<span class="unit">%</span></div>
      <div class="stat-label">API uptime<span class="stat-label-sub"> · ${uptimeHint}</span><span class="pulse-dot"></span></div>
    </div>
  </div>
</div>
  `;
}