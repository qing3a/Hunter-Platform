// src/main/modules/view/templates/landing/job-category-nav.ts
import { html } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

function industryEmoji(industry: string): string {
  const map: Record<string, string> = {
    '互联网/AI': '💻',
    '金融': '💰',
    '医疗': '🏥',
    '教育': '📚',
    '制造': '🏭',
    '销售': '💼',
    '设计': '🎨',
  };
  return map[industry] ?? '🏢';
}

export function jobCategoryNav(data: LandingData): string {
  if (data.industryNav.length === 0) {
    return html`
<section class="card job-category-nav" id="job-categories">
  <h2><span class="accent-bar"></span>📂 职位分类</h2>
  <p class="meta">暂无分类数据</p>
</section>
    `;
  }

  const items = data.industryNav.map((item) => html`
    <a class="job-category-item" href="#for-headhunters">
      <span class="job-category-emoji">${industryEmoji(item.industry)}</span>
      <span class="job-category-name">${item.industry}</span>
      <span class="job-category-count">${item.jobCount} 个岗位</span>
    </a>
  `).join('');

  return html`
<section class="card job-category-nav" id="job-categories">
  <h2><span class="accent-bar"></span>📂 职位分类</h2>
  <p class="meta">按行业浏览 — 共 ${data.openJobsCount} 个开放岗位</p>
  <div class="job-category-grid">${items}</div>
</section>
  `;
}