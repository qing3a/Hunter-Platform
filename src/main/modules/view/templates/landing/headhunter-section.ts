// src/main/modules/view/templates/landing/headhunter-section.ts
import { html } from '../lib/html.js';
import { jobCard } from '../partials/job-card.js';
import type { LandingData } from '../../gather-landing-data.js';

function renderBody(data: LandingData): string {
  if (data.recentJobs.length === 0) return '<div class="empty-state"><p class="empty-state-text">暂无开放岗位</p><p class="empty-state-cta">Agent 可调 <code>POST /v1/headhunter/jobs</code> 创建 → <a href="#for-employers">发布第一个岗位</a></p></div>';
  return `
    <div class="sub-card">
      <h3>▌最近 ${data.recentJobs.length} 个开放岗位</h3>
      ${data.recentJobs.map(jobCard).join('')}
    </div>
  `;
}

export function headhunterSection(data: LandingData): string {
  return html`
<section class="card" id="for-headhunters">
  <h2>
    <span class="accent-bar"></span>🎯 For Headhunters — 今日可推荐: ${data.openJobsCount} 个开放岗位
  </h2>
  <p>上传候选人脱敏入库 → Agent 调 <code>POST /v1/headhunter/candidates</code></p>
  ${renderBody(data)}
</section>
  `;
}