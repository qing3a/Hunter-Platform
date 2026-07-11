// src/main/modules/view/templates/landing/footer.ts
// P2c: footer strengthened with GitHub star, agent-friendly CTA, social links.
// Previously footer had only 4 API links + tagline → too weak for end-of-page.
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function footer(data: LandingData): string {
  return html`
<footer class="site-footer">
  <div class="footer-cta">
    <div class="footer-cta-text">
      <strong>🤖 让你的 Agent 接管招聘流程</strong>
      <p>把 <code>/v1/skill.md</code> 发给 AI Agent，它会自己学会调用平台 API。</p>
    </div>
    <div class="footer-cta-action">
      <button type="button" class="copy-btn copy-btn-cta js-copy-btn" data-copy="/v1/skill.md" title="一键复制 skill.md 完整 URL">
        📋 一键复制 skill.md
      </button>
    </div>
  </div>

  <div class="footer-grid">
    <div class="footer-col">
      <h4>Agent 接入</h4>
      <a href="/v1/skill.md" target="_blank" rel="noopener">📖 skill.md</a>
      <a href="/v1/openapi.json" target="_blank" rel="noopener">📋 OpenAPI</a>
      <a href="/v1/health" target="_blank" rel="noopener">🏥 Health</a>
      <a href="/metrics" target="_blank" rel="noopener">📊 Metrics</a>
    </div>
    <div class="footer-col">
      <h4>资源</h4>
      <a href="#for-roles">🔒 候选人隐私保护</a>
      <a href="#for-roles">💼 雇主接入指南</a>
      <a href="#for-roles">🎯 猎头分佣说明</a>
    </div>
    <div class="footer-col">
      <h4>社区</h4>
      <a href="https://github.com/" target="_blank" rel="noopener">⭐ GitHub Star</a>
      <a href="/v1/openapi.json" target="_blank" rel="noopener">📡 API Status</a>
      <a href="/v1/health" target="_blank" rel="noopener">🟢 System Health</a>
    </div>
  </div>

  <div class="footer-bottom">
    <p class="footer-brand">Made with care for Agents 🤖 · 候选人 PII 加密 · 4 步解锁协议 · 20% 平台抽佣</p>
    <p class="meta footer-time">数据更新于 ${data.serverTime} · 调用 <code>/v1/health</code> 查看实时状态</p>
  </div>
</footer>
  `;
}