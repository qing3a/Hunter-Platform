// src/main/modules/view/templates/partials/job-card.ts
import { html } from '../lib/html.js';
import { skillTags } from './skill-tag.js';
import type { RecentJob } from '../../gather-landing-data.js';

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

export function jobCard(j: RecentJob): string {
  return html`
    <div class="job-card">
      <div class="job-title">${j.title}</div>
      <div class="job-meta">
        <span class="industry-tag">${j.industry ?? '—'}</span>
        <span class="salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
      </div>
      <div class="tags">${skillTags(j.required_skills, 6)}</div>
    </div>
  `;
}