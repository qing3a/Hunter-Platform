// src/main/modules/view/templates/landing/stats.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function stats(data: LandingData): string {
  return html`
<div class="card hero-stats">
  <div class="stats-grid">
    <div class="stat">
      <div class="stat-icon">🔓</div>
      <div class="stat-value" data-target="${data.todayUnlocks}">${data.todayUnlocks}</div>
      <div class="stat-label">今日解锁</div>
    </div>
    <div class="stat">
      <div class="stat-icon">🎯</div>
      <div class="stat-value" data-target="${data.todayPlacements}">${data.todayPlacements}</div>
      <div class="stat-label">今日 placements</div>
    </div>
    <div class="stat">
      <div class="stat-icon">👥</div>
      <div class="stat-value" data-target="${data.totalCandidates}">${data.totalCandidates}</div>
      <div class="stat-label">活跃候选人</div>
    </div>
    <div class="stat">
      <div class="stat-icon">⚡</div>
      <div class="stat-value">${data.uptimePercent}<span class="unit">%</span></div>
      <div class="stat-label">API uptime<span class="pulse-dot"></span></div>
    </div>
  </div>
</div>
  `;
}