// src/main/modules/view/templates/partials/skill-tag.ts
import { html } from '../lib/html.js';

export function skillTag(skill: string): string {
  return html`<span class="tag skill">${skill}</span>`;
}

export function skillTags(skills: string[], limit = 6): string {
  return skills.slice(0, limit).map(skillTag).join('');
}