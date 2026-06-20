// src/main/modules/view/templates/landing/hero.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function hero(_data: LandingData): string {
  return html`
<section class="hero">
  <h1>🔍 Hunter Platform</h1>
  <p class="tagline">
    <strong>猎头中介 API 平台</strong> · 候选人隐私受保护 · 4 步解锁协议 · 20% 平台抽佣
  </p>

  <div class="agent-gate">
    <div class="agent-gate-header">
      <span class="agent-gate-emoji">🤖</span>
      <span class="agent-gate-title">把链接发给 AI Agent 即可对接</span>
    </div>
    <ul class="agent-gate-list">
      <li>
        <code>GET /v1/skill.md</code>
        <button type="button" class="copy-btn js-copy-btn" data-copy="/v1/skill.md">📋 一键复制</button>
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