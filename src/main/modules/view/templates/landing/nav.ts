// src/main/modules/view/templates/landing/nav.ts
// P1.7 v3: 重设计 nav — 4 角色 link 移到 hero (role-anchors) 避免重复
// nav 现在只 4 元素: 品牌 + status + Agent link + 复制按钮 (4 角色 link 只在 hero)
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
    <button type="button" class="nav-toggle js-nav-toggle" aria-label="切换菜单" aria-expanded="false">
      <span class="nav-toggle-icon">☰</span>
    </button>
    <div class="nav-collapsible js-nav-collapsible">
      <div class="nav-status">${statusBadge(data.healthStatus, data.uptimePercent)}</div>
      <a class="nav-cta-agent" href="#rankings">🤖 Agent 开发者</a>
      <button type="button" class="copy-btn js-copy-btn" data-copy="${'/v1/skill.md'}">
        📋 复制 skill.md
      </button>
    </div>
  </div>
</header>
  `;
}
