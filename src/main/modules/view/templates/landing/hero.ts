// src/main/modules/view/templates/landing/hero.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

// P3b: inline Lucide SVG icons replace emoji in role-cards for visual consistency
// with the rest of the brand identity (teal/cyan SaaS aesthetic).
// Lucide icon paths sourced from lucide.dev (ISC license).
const ICON = {
  shieldCheck: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  target: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  briefcase: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>',
};

export function hero(_data: LandingData): string {
  return html`
<section class="hero">
  <h1>4 步解锁候选人隐私</h1>
  <p class="tagline">
    <strong>猎头中介 API 平台</strong> · 候选人 PII 加密 · 撮合分佣 80% · 平台抽佣 20%
  </p>

  <div class="role-cards">
    <a class="role-card js-role-anchor" href="#for-roles" data-target="for-roles" data-role="candidates">
      <span class="role-icon" aria-hidden="true">${ICON.shieldCheck}</span>
      <h3 class="role-title">我是候选人</h3>
      <p class="role-desc">PII 加密存储，雇主浏览只看到脱敏数据</p>
      <span class="role-cta">了解隐私保护 →</span>
    </a>
    <a class="role-card js-role-anchor" href="#for-roles" data-target="for-roles" data-role="headhunters">
      <span class="role-icon" aria-hidden="true">${ICON.target}</span>
      <h3 class="role-title">我是猎头</h3>
      <p class="role-desc">上传候选人 → 平台撮合 → 成交分 80% 佣金</p>
      <span class="role-cta">上传候选人 →</span>
    </a>
    <a class="role-card js-role-anchor" href="#for-roles" data-target="for-roles" data-role="employers">
      <span class="role-icon" aria-hidden="true">${ICON.briefcase}</span>
      <h3 class="role-title">我是雇主</h3>
      <p class="role-desc">浏览脱敏候选人池 → 解锁联系方式 → 招到人</p>
      <span class="role-cta">浏览候选人 →</span>
    </a>
  </div>

  <div class="agent-gate">
    <div class="agent-gate-header">
      <span class="agent-gate-emoji" aria-hidden="true">🤖</span>
      <span class="agent-gate-title">把链接发给 AI Agent 即可对接</span>
    </div>
    <ul class="agent-gate-list">
      <li>
        <code>GET /v1/skill.md</code>
        <a class="link-btn" href="/v1/skill.md" target="_blank" rel="noopener">查看</a>
      </li>
      <li>
        <code>GET /v1/openapi.json</code>
        <a class="link-btn" href="/v1/openapi.json" target="_blank" rel="noopener">查看 OpenAPI</a>
      </li>
      <li>
        <code>GET /v1/health</code>
        <a class="link-btn" href="/v1/health" target="_blank" rel="noopener">查看状态</a>
      </li>
    </ul>
  </div>
</section>
  `;
}
