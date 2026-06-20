// src/main/modules/view/templates/partials/section-card.ts
import { html } from '../lib/html.js';

export interface SectionCardOptions {
  id?: string;
  title: string;
  subtitle?: string;
  body: string;  // pre-rendered HTML
}

export function sectionCard(opts: SectionCardOptions): string {
  return html`
    <section class="card" ${opts.id ? html`id="${opts.id}"` : ''}>
      <h2><span class="accent-bar"></span>${opts.title}</h2>
      ${opts.subtitle ? html`<p class="meta">${opts.subtitle}</p>` : ''}
      ${opts.body}
    </section>
  `;
}