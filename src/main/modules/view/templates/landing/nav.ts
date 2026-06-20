// src/main/modules/view/templates/landing/nav.ts
import { html } from '../lib/html.js';
import { statusBadge } from '../partials/status-badge.js';
import type { LandingData } from '../../gather-landing-data.js';

export function nav(data: LandingData): string {
  return html`
<header class="top-nav">
  <div class="nav-inner">
    <a class="brand" href="/">
      <span class="brand-mark">🔍</span>
      <span class="brand-name">Hunter Platform</span>
    </a>
    <div class="nav-status">${statusBadge(data.healthStatus, data.uptimePercent)}</div>
    <nav class="nav-links">
      <a href="#for-employers">🏢 雇主</a>
      <a href="#for-headhunters">🎯 猎头</a>
      <a href="#for-candidates">🔒 候选人</a>
      <a href="#rankings">🏆 榜单</a>
      <a href="/v1/skill.md" target="_blank" rel="noopener">📖 API</a>
      <a href="/v1/openapi.json" target="_blank" rel="noopener">📋 OpenAPI</a>
      <a href="/v1/health" target="_blank" rel="noopener">🏥 Health</a>
    </nav>
    <button type="button" class="copy-btn js-copy-btn" data-copy="${'/v1/skill.md'}">
      📋 复制 skill.md
    </button>
  </div>
</header>
  `;
}