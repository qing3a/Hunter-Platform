// src/main/modules/view/templates/landing/roles-switcher.ts
// P1c: 合并 3 个独立 for-X section（for-candidates / for-employers / for-headhunters）
// 为 1 个 tab 切换器。理由：3 个 section 叙事高度重复，占 3 屏视觉空间。
// 新设计：1 个 section 3 个 tab（用现有 rankings.ts 同样的 pill-tab 样式复用）。
// 默认 tab = candidates（隐私叙事最先展示，符合 B1 前置逻辑）。
import { html } from '../lib/html.js';
import { candidateCard } from '../partials/candidate-card.js';
import { jobCard } from '../partials/job-card.js';
import type { LandingData } from '../../gather-landing-data.js';

function renderCandidates(data: LandingData): string {
  const activeProUsers = data.activeEmployerCount + data.activeHeadhunterCount;
  const activeHint = activeProUsers > 0
    ? `当前活跃 ${activeProUsers} 位专业用户`
    : '平台刚启动 · 等你成为首位';
  return `
    <p>候选人的 PII 全程加密存储，只有候选人本人授权解锁后，对方才能看到联系方式。</p>
    <div class="timeline">
      <div class="timeline-item done"><strong>1. 猎头上传时自动脱敏</strong> — industry / title_level / salary_range</div>
      <div class="timeline-item done"><strong>2. 雇主浏览只看到脱敏数据</strong> — 真实联系方式永远不可见</div>
      <div class="timeline-item done"><strong>3. 雇主表达兴趣时通知候选人</strong> — webhook 推送 + Agent 查询</div>
      <div class="timeline-item current"><strong>4. 候选人授权后才解锁联系方式</strong> — ${activeHint}</div>
    </div>
  `;
}

function renderEmployers(data: LandingData): string {
  if (data.publicCandidatesCount === 0) {
    return '<div class="empty-state"><p class="empty-state-text">暂无公开候选人</p><p class="empty-state-cta">想找候选人？<a href="/v1/skill.md#for-employers">查看 skill.md</a></p></div>';
  }
  return data.industryGroups.map((g) => `
    <div class="sub-card">
      <h3>▌${g.industry || '其他'} (${g.candidates.length} 人)</h3>
      ${g.candidates.slice(0, 3).map(candidateCard).join('')}
    </div>
  `).join('');
}

function renderHeadhunters(data: LandingData): string {
  if (data.recentJobs.length === 0) {
    return '<div class="empty-state"><p class="empty-state-text">暂无开放岗位</p><p class="empty-state-cta">Agent 可调 <code>POST /v1/headhunter/jobs</code> 创建 → <a href="/v1/openapi.json">发布第一个岗位</a></p></div>';
  }
  return `
    <div class="sub-card">
      <h3>▌最近 ${data.recentJobs.length} 个开放岗位</h3>
      ${data.recentJobs.map(jobCard).join('')}
    </div>
  `;
}

export function rolesSwitcher(data: LandingData): string {
  return html`
<section class="card roles-switcher" id="for-roles">
  <h2><span class="accent-bar"></span>🎭 我是哪个角色？</h2>
  <div class="ranking-tabs js-roles-tabs" role="tablist" aria-label="角色切换">
    <button class="ranking-tab js-roles-tab active" data-tab="candidates" role="tab" id="roles-tab-candidates" aria-controls="roles-panel-candidates" aria-selected="true" tabindex="0">🔒 候选人</button>
    <button class="ranking-tab js-roles-tab" data-tab="employers" role="tab" id="roles-tab-employers" aria-controls="roles-panel-employers" aria-selected="false" tabindex="-1">💼 雇主</button>
    <button class="ranking-tab js-roles-tab" data-tab="headhunters" role="tab" id="roles-tab-headhunters" aria-controls="roles-panel-headhunters" aria-selected="false" tabindex="-1">🎯 猎头</button>
  </div>
  <div class="roles-panels">
    <div class="roles-panel js-roles-panel active" data-panel="candidates" id="roles-panel-candidates" role="tabpanel" aria-labelledby="roles-tab-candidates">${renderCandidates(data)}</div>
    <div class="roles-panel js-roles-panel" data-panel="employers" id="roles-panel-employers" role="tabpanel" aria-labelledby="roles-tab-employers" hidden>${renderEmployers(data)}</div>
    <div class="roles-panel js-roles-panel" data-panel="headhunters" id="roles-panel-headhunters" role="tabpanel" aria-labelledby="roles-tab-headhunters" hidden>${renderHeadhunters(data)}</div>
  </div>
</section>
  `;
}