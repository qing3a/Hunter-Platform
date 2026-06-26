// src/main/modules/view/templates/landing/hero.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function hero(_data: LandingData): string {
  return html`
<section class="hero">
  <h1>3 步解锁候选人隐私</h1>
  <p class="tagline">
    <strong>猎头中介 API 平台</strong> · 候选人 PII 加密 · 4 步解锁协议 · 20% 平台抽佣
  </p>

  <div class="role-anchors">
    <a class="role-card" href="#for-candidates">
      <span class="role-emoji">🔒</span>
      <h3 class="role-title">我是候选人</h3>
      <p class="role-desc">PII 加密存储，雇主浏览只看到脱敏数据</p>
      <span class="role-cta">了解隐私保护 →</span>
    </a>
    <a class="role-card" href="#for-headhunters">
      <span class="role-emoji">🎯</span>
      <h3 class="role-title">我是猎头</h3>
      <p class="role-desc">上传候选人 → 平台撮合 → 成交分 80% 佣金</p>
      <span class="role-cta">上传候选人 →</span>
    </a>
    <a class="role-card" href="#for-employers">
      <span class="role-emoji">💼</span>
      <h3 class="role-title">我是雇主</h3>
      <p class="role-desc">浏览脱敏候选人池 → 解锁联系方式 → 招到人</p>
      <span class="role-cta">浏览候选人 →</span>
    </a>
  </div>

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
