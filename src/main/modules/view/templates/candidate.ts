import { SHARED_CSS } from './shared-css.js';

export interface CandidateViewData {
  anonymizedId: string;
  industry: string;
  titleLevel: string;
  salaryRange: string;
  educationTier: string;
  yearsExperience: number;
  skills: string[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderCandidate(d: CandidateViewData): string {
  const skillsHtml = d.skills.map((s) => `<span class="tag skill">${esc(s)}</span>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>候选人画像 — ${esc(d.anonymizedId)}</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>候选人画像</h1>
    <p class="meta">匿名 ID: <code>${esc(d.anonymizedId)}</code></p>

    <div class="card">
      <h2>基本信息</h2>
      <dl class="kv">
        <dt>行业</dt><dd><span class="tag industry">${esc(d.industry)}</span></dd>
        <dt>职级</dt><dd>${esc(d.titleLevel)}</dd>
        <dt>薪资范围</dt><dd>${esc(d.salaryRange)}</dd>
        <dt>学历</dt><dd>${esc(d.educationTier)}</dd>
        <dt>工作年限</dt><dd>${d.yearsExperience} 年</dd>
      </dl>
    </div>

    <div class="card">
      <h2>技能</h2>
      <div>${skillsHtml}</div>
    </div>

    <p class="meta">此页面展示的是脱敏后的候选人画像。原始联系方式需通过解锁流程获取。</p>
  </main>
</body>
</html>`;
}