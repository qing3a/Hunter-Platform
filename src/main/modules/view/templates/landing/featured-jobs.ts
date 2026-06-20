// src/main/modules/view/templates/landing/featured-jobs.ts
import { html, raw } from '../lib/html.js';
import type { FeaturedJob, LandingData } from '../../gather-landing-data.js';

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

function priorityBadge(priority: FeaturedJob['priority']): string {
  if (priority === 'urgent') return '<span class="badge badge-urgent">急</span>';
  if (priority === 'high')   return '<span class="badge badge-hot">热</span>';
  return '';
}

function formatSkills(skills: string[]): string {
  return skills.slice(0, 6).map((s) => `<span class="tag skill">${s}</span>`).join('');
}

export function featuredJobs(data: LandingData): string {
  if (data.featuredJobs.length === 0) {
    return html`
<section class="card featured-jobs" id="featured-jobs">
  <h2><span class="accent-bar"></span>🔥 精选/热招职位</h2>
  <p class="meta">暂无开放岗位。Agent 可调 <code>POST /v1/headhunter/jobs</code> 创建</p>
</section>
    `;
  }

  const cards = data.featuredJobs.map((j) => html`
    <div class="featured-job-card">
      <div class="featured-job-top">
        ${raw(priorityBadge(j.priority))}
        <span class="featured-job-salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
      </div>
      <div class="featured-job-title">📋 ${j.title}</div>
      <div class="featured-job-meta">
        🏢 ${j.company_name ?? '某公司'} · ${j.industry ?? '其他'}
      </div>
      <div class="featured-job-skills">${raw(formatSkills(j.required_skills))}</div>
    </div>
  `).join('');

  return html`
<section class="card featured-jobs" id="featured-jobs">
  <h2><span class="accent-bar"></span>🔥 精选/热招职位</h2>
  <p class="meta">前 ${data.featuredJobs.length} 个开放岗位 — 按紧急度排序</p>
  <div class="featured-jobs-grid">${cards}</div>
  <p class="meta featured-jobs-more" data-feature="see-more-featured-jobs">查看更多 → (MVP 不做)</p>
</section>
  `;
}