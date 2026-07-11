// src/main/modules/view/templates/landing/rankings.ts
import { html } from '../lib/html.js';
import { rankingRow } from '../partials/ranking-row.js';
import { skillTag } from '../partials/skill-tag.js';
import type { LandingData } from '../../gather-landing-data.js';

function isAllEmpty(data: LandingData): boolean {
  return (
    data.topHeadhunters.length === 0 &&
    data.topEmployers.length === 0 &&
    data.topIndustries.length === 0 &&
    data.latestPlacements.length === 0 &&
    data.hotSkills.length === 0
  );
}

function renderTopHeadhunters(data: LandingData): string {
  if (data.topHeadhunters.length === 0) return '<p class="meta">暂无猎头数据</p>';
  return data.topHeadhunters.map((h) =>
    rankingRow(h.rank, h.name, `reputation ${h.reputation}`, h.reputation)
  ).join('');
}

function renderTopEmployers(data: LandingData): string {
  if (data.topEmployers.length === 0) return '<p class="meta">暂无雇主数据</p>';
  return data.topEmployers.map((e, i) =>
    rankingRow(i + 1, e.name, `${e.recCount} 个推荐`, e.recCount)
  ).join('');
}

function renderTopIndustries(data: LandingData): string {
  if (data.topIndustries.length === 0) return '<p class="meta">暂无行业数据</p>';
  return data.topIndustries.map((ind, i) =>
    rankingRow(i + 1, ind.industry, `${ind.candCount} 个候选人`, ind.candCount)
  ).join('');
}

function renderLatestPlacements(data: LandingData): string {
  if (data.latestPlacements.length === 0) return '<p class="meta">暂无最近 placement 记录</p>';
  return data.latestPlacements.map((p) => `
    <div class="placement-row">
      <div class="placement-title">${p.title} <span class="industry-tag">${p.industry ?? '其他'}</span></div>
      <div class="placement-meta">
        <span class="placement-salary">¥${p.salaryText}</span>
        <span class="placement-hh">by ${p.headhunterName}</span>
        <span class="placement-time">${p.at}</span>
      </div>
    </div>
  `).join('');
}

function renderHotSkills(data: LandingData): string {
  if (data.hotSkills.length === 0) return '<p class="meta">暂无可统计的热门技能</p>';
  return `<div class="tags tags-block">${data.hotSkills.map((s) => skillTag(`${s.skill} (${s.count})`)).join('')}</div>`;
}

export function rankings(data: LandingData): string {
  // P2b: cold-start collapse — when ALL 5 ranking categories are empty, render
  // a compact single-panel "waiting" placeholder instead of 5 empty tabs.
  if (isAllEmpty(data)) {
    return html`
<section class="card rankings rankings-empty" id="rankings">
  <h2><span class="accent-bar"></span>🏆 多维榜单</h2>
  <div class="empty-state">
    <p class="empty-state-text">榜单将在首批数据后开放</p>
    <p class="empty-state-cta">等待猎头/雇主加入 → <a href="/v1/openapi.json">查看 OpenAPI</a></p>
  </div>
</section>
    `;
  }

  return html`
<section class="card rankings" id="rankings">
  <h2><span class="accent-bar"></span>🏆 多维榜单</h2>
  <div class="ranking-tabs" role="tablist" aria-label="榜单分类">
    <button class="ranking-tab js-ranking-tab active" data-tab="hunters" role="tab" id="ranking-tab-hunters" aria-controls="ranking-panel-hunters" aria-selected="true" tabindex="0">Top 猎头</button>
    <button class="ranking-tab js-ranking-tab" data-tab="employers" role="tab" id="ranking-tab-employers" aria-controls="ranking-panel-employers" aria-selected="false" tabindex="-1">Top 雇主</button>
    <button class="ranking-tab js-ranking-tab" data-tab="industries" role="tab" id="ranking-tab-industries" aria-controls="ranking-panel-industries" aria-selected="false" tabindex="-1">Top 行业</button>
    <button class="ranking-tab js-ranking-tab" data-tab="placements" role="tab" id="ranking-tab-placements" aria-controls="ranking-panel-placements" aria-selected="false" tabindex="-1">成交</button>
    <button class="ranking-tab js-ranking-tab" data-tab="skills" role="tab" id="ranking-tab-skills" aria-controls="ranking-panel-skills" aria-selected="false" tabindex="-1">Hot Skills</button>
  </div>
  <div class="ranking-panels">
    <div class="ranking-panel js-ranking-panel active" data-panel="hunters" id="ranking-panel-hunters" role="tabpanel" aria-labelledby="ranking-tab-hunters">${renderTopHeadhunters(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="employers" id="ranking-panel-employers" role="tabpanel" aria-labelledby="ranking-tab-employers" hidden>${renderTopEmployers(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="industries" id="ranking-panel-industries" role="tabpanel" aria-labelledby="ranking-tab-industries" hidden>${renderTopIndustries(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="placements" id="ranking-panel-placements" role="tabpanel" aria-labelledby="ranking-tab-placements" hidden>${renderLatestPlacements(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="skills" id="ranking-panel-skills" role="tabpanel" aria-labelledby="ranking-tab-skills" hidden>${renderHotSkills(data)}</div>
  </div>
</section>
  `;
}