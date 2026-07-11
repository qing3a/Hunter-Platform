// src/main/modules/view/templates/landing/candidate-section.ts
// B1 fix: this section was promoted to the first content block right after hero
// (see renderLanding in index.ts) so first-time visitors see the platform privacy
// promise before any cold-start empty data sections. Tone shifted from
// "For Candidates — 仅候选人看" to "平台隐私怎么保护" — applies to all visitors.
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function candidateSection(data: LandingData): string {
  const activeProUsers = data.activeEmployerCount + data.activeHeadhunterCount;
  const activeHint = activeProUsers > 0
    ? `当前活跃 ${activeProUsers} 位专业用户`
    : '平台刚启动 · 等你成为首位';
  return html`
<section class="card" id="for-candidates">
  <h2>
    <span class="accent-bar"></span>🔒 平台怎么保护候选人隐私
  </h2>
  <p>候选人的 PII 全程加密存储，只有候选人本人授权解锁后，对方才能看到联系方式。</p>
  <div class="timeline">
    <div class="timeline-item done">
      <strong>1. 猎头上传时自动脱敏</strong> — industry / title_level / salary_range
    </div>
    <div class="timeline-item done">
      <strong>2. 雇主浏览只看到脱敏数据</strong> — 真实联系方式永远不可见
    </div>
    <div class="timeline-item done">
      <strong>3. 雇主表达兴趣时通知候选人</strong> — webhook 推送 + Agent 查询
    </div>
    <div class="timeline-item current">
      <strong>4. 候选人授权后才解锁联系方式</strong> — ${activeHint}
    </div>
  </div>
</section>
  `;
}