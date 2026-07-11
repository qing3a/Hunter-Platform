// src/main/modules/view/templates/landing/nav.ts
// Header redesign: 60px single-row, 4 sections (brand / spacer / actions / hamburger).
// Mobile: brand + ☰ on row 1; ☰ expands to show actions + role-anchors (via landing.script.ts).
import { html } from '../lib/html.js';
import { statusBadge } from '../partials/status-badge.js';
import type { LandingData } from '../../gather-landing-data.js';

// Inline Lucide SVG icons (ISC license) — see P3b.
const ICON = {
  search: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  bot: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
  menu: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
};

export function nav(data: LandingData): string {
  return html`
<header class="top-nav">
  <div class="nav-inner">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">${ICON.search}</span>
      <span class="brand-text">
        <span class="brand-name">Hunter Platform</span>
        <span class="brand-tagline">猎头中介 API</span>
      </span>
    </a>

    <div class="nav-spacer"></div>

    <div class="nav-actions">
      <span class="status-badge">${statusBadge(data.healthStatus, data.uptimePercent)}</span>
      <button type="button" class="copy-btn-compact js-copy-btn" data-copy="/v1/skill.md" title="复制 skill.md URL" aria-label="复制 skill.md">
        ${ICON.copy}
      </button>
      <a class="nav-cta-agent" href="#rankings" title="为 AI Agent 开发者">
        ${ICON.bot}
        <span>Agent</span>
      </a>
      <button type="button" class="nav-toggle" aria-label="切换菜单" aria-expanded="false">
        ${ICON.menu}
      </button>
    </div>
  </div>
</header>
  `;
}