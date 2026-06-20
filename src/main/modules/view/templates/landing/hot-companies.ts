// src/main/modules/view/templates/landing/hot-companies.ts
import { html, raw } from '../lib/html.js';
import type { LandingData } from '../../gather-landing-data.js';

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

function renderRecentJobs(jobs: LandingData['hotCompanies'][number]['recentJobs']): string {
  if (jobs.length === 0) return '<p class="meta">暂无开放岗位</p>';
  return jobs.map((j) => `
    <div class="hot-company-job">
      <span class="hot-company-job-title">▸ ${j.title}</span>
      <span class="hot-company-job-salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
    </div>
  `).join('');
}

export function hotCompanies(data: LandingData): string {
  if (data.hotCompanies.length === 0) {
    return html`
<section class="card hot-companies" id="hot-companies">
  <h2><span class="accent-bar"></span>🏢 热门企业</h2>
  <p class="meta">暂无热门企业</p>
</section>
    `;
  }

  const cards = data.hotCompanies.map((c) => html`
    <div class="hot-company-card">
      <div class="hot-company-header">
        <span class="hot-company-name">🏢 ${c.name}</span>
        <span class="hot-company-count">${c.openJobCount} 个开放岗位</span>
      </div>
      <div class="hot-company-jobs">${raw(renderRecentJobs(c.recentJobs))}</div>
      <p class="meta hot-company-more">查看更多 → (MVP 不做)</p>
    </div>
  `).join('');

  return html`
<section class="card hot-companies" id="hot-companies">
  <h2><span class="accent-bar"></span>🏢 热门企业</h2>
  <p class="meta">按开放岗位数倒序</p>
  <div class="hot-companies-grid">${cards}</div>
</section>
  `;
}