import { SHARED_CSS } from './shared-css.js';

export type RecommendationStatus =
  | 'pending' | 'pending_pickup' | 'considering_offer'
  | 'employer_interested' | 'candidate_approved'
  | 'unlocked' | 'placed' | 'rejected_employer' | 'rejected_candidate' | 'withdrawn';

export interface RecommendationViewData {
  recommendationId: string;
  candidateAnonymizedId: string;
  jobTitle: string | null;
  status: RecommendationStatus;
  createdAt: string;
  updatedAt: string;
}

const TIMELINE: Array<{ key: RecommendationStatus; label: string }> = [
  { key: 'pending', label: '猎头推荐' },
  { key: 'employer_interested', label: '雇主感兴趣' },
  { key: 'candidate_approved', label: '候选人授权' },
  { key: 'unlocked', label: '联系方式解锁' },
  { key: 'placed', label: '入职' },
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderRecommendation(d: RecommendationViewData): string {
  const currentIdx = TIMELINE.findIndex((t) => t.key === d.status);
  const isRejected = d.status.startsWith('rejected_') || d.status === 'withdrawn';

  const items = TIMELINE.map((t, i) => {
    let cls = 'timeline-item';
    if (!isRejected && i < currentIdx) cls += ' done';
    else if (!isRejected && i === currentIdx) cls += ' current';
    return `<div class="${cls}"><strong>${esc(t.label)}</strong></div>`;
  }).join('');

  const rejectNotice = isRejected
    ? `<div class="card" style="background:#fff5f5;border-color:#fc8181"><strong>状态：${esc(d.status)}</strong></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>推荐状态 — ${esc(d.recommendationId)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>推荐状态</h1>
    <p class="meta">推荐 ID: <code>${esc(d.recommendationId)}</code></p>

    <div class="card">
      <h2>信息</h2>
      <dl class="kv">
        <dt>候选人</dt><dd><code>${esc(d.candidateAnonymizedId)}</code></dd>
        <dt>职位</dt><dd>${d.jobTitle ? esc(d.jobTitle) : '<em>未关联</em>'}</dd>
        <dt>创建时间</dt><dd>${esc(d.createdAt)}</dd>
        <dt>更新时间</dt><dd>${esc(d.updatedAt)}</dd>
      </dl>
    </div>

    ${rejectNotice}

    <div class="card">
      <h2>4 步解锁流程</h2>
      <div class="timeline">${items}</div>
    </div>
  </main>
</body>
</html>`;
}