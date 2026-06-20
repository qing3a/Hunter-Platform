// src/main/modules/view/templates/landing/index.ts
import { html } from '../lib/html.js';
import { layout } from './layout.js';
import { nav } from './nav.js';
import { roleAnchors } from './role-anchors.js';
import { hero } from './hero.js';
import { stats } from './stats.js';
import { rankings } from './rankings.js';
import { employerSection } from './employer-section.js';
import { headhunterSection } from './headhunter-section.js';
import { candidateSection } from './candidate-section.js';
import { footer } from './footer.js';
import type { LandingData } from '../../gather-landing-data.js';

export function renderLanding(data: LandingData): string {
  return layout(html`
    <main>
      ${nav(data)}
      ${roleAnchors()}
      ${hero(data)}
      ${stats(data)}
      ${rankings(data)}
      ${employerSection(data)}
      ${headhunterSection(data)}
      ${candidateSection(data)}
      ${footer(data)}
    </main>
  `);
}