// src/main/modules/view/templates/landing/role-anchors.ts
// Sticky layer 2 (under top-nav): 3 role pills + right-side quick-jump to rankings.
// Agent 开发者 is no longer here — it lives in nav.ts as an independent teal CTA
// to keep "platform roles" (雇主/猎头/候选人) semantically separate from
// "developer audience" (Agent builders).
import { html } from '../lib/html.js';

const ICON = {
  briefcase: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>',
  target: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  shieldCheck: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  trophy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2"/></svg>',
  arrowRight: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
};

export function roleAnchors(): string {
  return html`
<nav class="role-anchors" aria-label="快速跳转">
  <div class="role-pills">
    <a class="role-anchor js-role-anchor" href="#for-roles" data-target="for-roles" data-role="employers">
      <span class="role-icon" aria-hidden="true">${ICON.briefcase}</span><span>雇主</span>
    </a>
    <a class="role-anchor js-role-anchor" href="#for-roles" data-target="for-roles" data-role="headhunters">
      <span class="role-icon" aria-hidden="true">${ICON.target}</span><span>猎头</span>
    </a>
    <a class="role-anchor js-role-anchor" href="#for-roles" data-target="for-roles" data-role="candidates">
      <span class="role-icon" aria-hidden="true">${ICON.shieldCheck}</span><span>候选人</span>
    </a>
  </div>
  <a class="rankings-jump js-role-anchor" href="#rankings" data-target="rankings">
    <span class="role-icon" aria-hidden="true">${ICON.trophy}</span>
    <span>多维榜单</span>
    <span class="role-icon" aria-hidden="true">${ICON.arrowRight}</span>
  </a>
</nav>
  `;
}