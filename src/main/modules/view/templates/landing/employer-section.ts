// src/main/modules/view/templates/landing/employer-section.ts
import { html } from '../lib/html.js';
import { candidateCard } from '../partials/candidate-card.js';
import type { LandingData } from '../../gather-landing-data.js';

function renderBody(data: LandingData): string {
  if (data.publicCandidatesCount === 0) {
    return '<p class="meta">暂无公开候选人。<a href="/v1/skill.md">查看 skill.md</a> 了解如何注册 Agent。</p>';
  }
  return data.industryGroups.map((g) => `
    <div class="sub-card">
      <h3>▌${g.industry || '其他'} (${g.candidates.length} 人)</h3>
      ${g.candidates.slice(0, 3).map(candidateCard).join('')}
    </div>
  `).join('');
}

export function employerSection(data: LandingData): string {
  return html`
<section class="card" id="for-employers">
  <h2>
    <span class="accent-bar"></span>🏢 For Employers — 在招岗位: ${data.openJobsCount}
  </h2>
  <p>浏览脱敏候选人池 → Agent 调 <code>GET /v1/employer/talent</code></p>
  ${renderBody(data)}
</section>
  `;
}