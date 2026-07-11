// src/main/modules/view/templates/partials/status-badge.ts
// Simplified: only show health status (HEALTHY/DEGRADED/DOWN), drop uptime percentage
// from the badge. Uptime is already displayed prominently in the stats card section
// (hero-stats "API uptime" with process-uptime hint), so duplicating it in the nav
// was redundant noise.
import { html } from '../lib/html.js';
import type { HealthStatus } from '../../gather-landing-data.js';

export function statusBadge(status: HealthStatus, _uptimePercent: number): string {
  const labelMap: Record<HealthStatus, string> = {
    healthy: 'HEALTHY',
    degraded: 'DEGRADED',
    down: 'DOWN',
  };
  return html`
    <span class="status-badge" data-status="${status}" title="服务状态: ${labelMap[status]}">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="status-label-text">${labelMap[status]}</span>
    </span>
  `;
}