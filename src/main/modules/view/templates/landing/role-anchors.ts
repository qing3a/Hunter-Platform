// src/main/modules/view/templates/landing/role-anchors.ts
import { html } from '../lib/html.js';

export function roleAnchors(): string {
  return html`
<nav class="role-anchors" aria-label="快速跳转">
  <a class="role-anchor js-role-anchor" href="#for-employers" data-target="for-employers">
    <span class="role-emoji">🏢</span><span>雇主</span>
  </a>
  <a class="role-anchor js-role-anchor" href="#for-headhunters" data-target="for-headhunters">
    <span class="role-emoji">🎯</span><span>猎头</span>
  </a>
  <a class="role-anchor js-role-anchor" href="#for-candidates" data-target="for-candidates">
    <span class="role-emoji">🔒</span><span>候选人</span>
  </a>
  <a class="role-anchor js-role-anchor" href="#rankings" data-target="rankings">
    <span class="role-emoji">🤖</span><span>Agent 开发者</span>
  </a>
</nav>
  `;
}