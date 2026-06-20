// src/main/modules/view/templates/partials/status-badge.ts
import { html } from '../lib/html.js';
import type { HealthStatus } from '../../gather-landing-data.js';

export function statusBadge(status: HealthStatus, uptimePercent: number): string {
  const colorMap: Record<HealthStatus, string> = {
    healthy: '#22c55e',
    degraded: '#f59e0b',
    down: '#ef4444',
  };
  const labelMap: Record<HealthStatus, string> = {
    healthy: 'HEALTHY',
    degraded: 'DEGRADED',
    down: 'DOWN',
  };
  return html`
    <span class="status-badge" data-status="${status}" title="服务状态: ${labelMap[status]}">
      <span class="status-dot" style="background:${colorMap[status]}"></span>
      ${labelMap[status]} ${uptimePercent}<span class="unit">%</span>
    </span>
  `;
}