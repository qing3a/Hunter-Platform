// src/main/modules/view/templates/landing/footer.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function footer(data: LandingData): string {
  return html`
<footer class="site-footer">
  <div class="footer-links">
    <a href="/v1/skill.md" target="_blank" rel="noopener">📖 skill.md</a>
    <a href="/v1/openapi.json" target="_blank" rel="noopener">📋 OpenAPI</a>
    <a href="/v1/health" target="_blank" rel="noopener">🏥 Health</a>
    <a href="/metrics" target="_blank" rel="noopener">📊 Metrics</a>
  </div>
  <p class="footer-brand">Made with care for Agents 🤖</p>
  <p class="meta footer-time">数据更新于 ${data.serverTime} · 调用 <code>/v1/health</code> 查看实时状态</p>
</footer>
  `;
}