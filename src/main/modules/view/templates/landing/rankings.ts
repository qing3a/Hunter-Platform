// src/main/modules/view/templates/landing/rankings.ts
import { html } from '../lib/html.js';
import { rankingRow } from '../partials/ranking-row.js';
import { skillTag } from '../partials/skill-tag.js';
import type { LandingData } from '../../gather-landing-data.js';

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
  return html`
<section class="card rankings" id="rankings">
  <h2><span class="accent-bar"></span>🏆 多维榜单</h2>
  <div class="ranking-tabs" role="tablist">
    <button class="ranking-tab js-ranking-tab active" data-tab="hunters" role="tab">Top 猎头</button>
    <button class="ranking-tab js-ranking-tab" data-tab="employers" role="tab">Top 雇主</button>
    <button class="ranking-tab js-ranking-tab" data-tab="industries" role="tab">Top 行业</button>
    <button class="ranking-tab js-ranking-tab" data-tab="placements" role="tab">成交</button>
    <button class="ranking-tab js-ranking-tab" data-tab="skills" role="tab">Hot Skills</button>
  </div>
  <div class="ranking-panels">
    <div class="ranking-panel js-ranking-panel active" data-panel="hunters">${renderTopHeadhunters(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="employers" hidden>${renderTopEmployers(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="industries" hidden>${renderTopIndustries(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="placements" hidden>${renderLatestPlacements(data)}</div>
    <div class="ranking-panel js-ranking-panel" data-panel="skills" hidden>${renderHotSkills(data)}</div>
  </div>
</section>
  `;
}