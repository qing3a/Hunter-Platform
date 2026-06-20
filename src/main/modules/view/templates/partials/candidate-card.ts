// src/main/modules/view/templates/partials/candidate-card.ts
import { html } from '../lib/html.js';
import { skillTags } from './skill-tag.js';
import type { CandidateCard } from '../../gather-landing-data.js';

export function candidateCard(c: CandidateCard): string {
  return html`
    <div class="candidate-card">
      <dl class="kv">
        <dt>职级</dt><dd>${c.title_level ?? '—'}</dd>
        <dt>工作年限</dt><dd>${c.years_experience ?? '—'} 年</dd>
        <dt>薪资范围</dt><dd>${c.salary_range ?? '—'}</dd>
        <dt>学历</dt><dd>${c.education_tier ?? '—'}</dd>
      </dl>
      <div class="tags">${skillTags(c.skills, 6)}</div>
    </div>
  `;
}