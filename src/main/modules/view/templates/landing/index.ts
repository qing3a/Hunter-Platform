// src/main/modules/view/templates/landing/index.ts
import { html } from '../lib/html.js';
import { layout } from './layout.js';
import { nav } from './nav.js';
import { roleAnchors } from './role-anchors.js';
import { hero } from './hero.js';
import { stats } from './stats.js';
import { rankings } from './rankings.js';
import { rolesSwitcher } from './roles-switcher.js';
import { footer } from './footer.js';
import { jobCategoryNav } from './job-category-nav.js';
import { featuredJobs } from './featured-jobs.js';
import { hotCompanies } from './hot-companies.js';
import type { LandingData } from '../../gather-landing-data.js';

export function renderLanding(data: LandingData): string {
  return layout(html`
    <main id="main-content">
      ${nav(data)}
      ${roleAnchors()}
      ${hero(data)}
      ${stats(data)}
      ${rolesSwitcher(data)}
      ${jobCategoryNav(data)}
      ${featuredJobs(data)}
      ${hotCompanies(data)}
      ${rankings(data)}
      ${footer(data)}
    </main>
  `);
}