// src/main/modules/view/templates/landing/candidate-section.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

export function candidateSection(data: LandingData): string {
  const activeProUsers = data.activeEmployerCount + data.activeHeadhunterCount;
  return html`
<section class="card" id="for-candidates">
  <h2>
    <span class="accent-bar"></span>🔒 For Candidates — 当前活跃 ${activeProUsers} 位专业用户
  </h2>
  <p>你的 PII 加密存储，只有你授权解锁后才能被对方看到</p>
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
      <strong>4. 候选人授权后才解锁联系方式</strong> — 你完全控制
    </div>
  </div>
</section>
  `;
}