import { SHARED_CSS } from './shared-css.js';

export interface CandidateCard {
  anonymized_id: string;
  industry: string | null;
  title_level: string | null;
  years_experience: number | null;
  salary_range: string | null;
  education_tier: string | null;
  skills: string[];
}

export interface IndustryGroup {
  industry: string;
  candidates: CandidateCard[];
}

export interface RecentJob {
  title: string;
  industry: string | null;
  salary_min: number | null;
  salary_max: number | null;
  required_skills: string[];
}

export interface LandingData {
  openJobsCount: number;
  publicCandidatesCount: number;
  industryGroups: IndustryGroup[];
  recentJobs: RecentJob[];
  activeEmployerCount: number;
  activeHeadhunterCount: number;
  serverTime: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  if (min != null && max != null) return `${min / 10000}万 - ${max / 10000}万`;
  if (min != null) return `${min / 10000}万+`;
  return `≤ ${max! / 10000}万`;
}

export function renderLanding(d: LandingData): string {
  const activeProUsers = d.activeEmployerCount + d.activeHeadhunterCount;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Hunter Platform · 猎头中介 API 平台</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>🔍 Hunter Platform</h1>
    <p class="meta"><strong>猎头中介 API 平台</strong> · 候选人隐私受保护 · 4 步解锁协议 · 20% 平台抽佣</p>
    <p class="meta">
      <a href="/v1/skill.md">📖 API 文档 (skill.md)</a> ·
      <a href="/v1/openapi.json">📋 OpenAPI spec</a> ·
      <a href="/v1/health">🏥 Health</a>
    </p>

    <div class="card">
      <h2>🏢 For Employers — 在招岗位: ${d.openJobsCount}</h2>
      <p>浏览脱敏候选人池 → Agent 调 <code>GET /v1/employer/talent</code></p>
      <p class="meta">候选人不需注册，只需要雇主 Agent 调用 API 即可浏览</p>

      ${d.publicCandidatesCount === 0
        ? '<p>暂无公开候选人。<a href="/v1/skill.md">查看 skill.md</a> 了解如何注册 Agent。</p>'
        : d.industryGroups.map((g) => `
            <div class="card">
              <h3>▌${esc(g.industry || '其他')} (${g.candidates.length}人)</h3>
              ${g.candidates.map((c) => `
                <div class="card">
                  <dl class="kv">
                    <dt>职级</dt><dd>${esc(c.title_level || '—')}</dd>
                    <dt>工作年限</dt><dd>${c.years_experience ?? '—'} 年</dd>
                    <dt>薪资范围</dt><dd>${esc(c.salary_range || '—')}</dd>
                    <dt>学历</dt><dd>${esc(c.education_tier || '—')}</dd>
                  </dl>
                  <div>${c.skills.slice(0, 6).map((s) => `<span class="tag skill">${esc(s)}</span>`).join('')}</div>
                </div>
              `).join('')}
            </div>
          `).join('')}
    </div>

    <div class="card">
      <h2>🎯 For Headhunters — 今日可推荐: ${d.openJobsCount} 个开放岗位</h2>
      <p>上传候选人脱敏入库 → Agent 调 <code>POST /v1/headhunter/candidates</code></p>
      <p class="meta">每次成功 placement 拿 20% 佣金</p>

      ${d.recentJobs.length === 0
        ? '<p>暂无开放岗位。</p>'
        : `<div class="card">
            <h3>▌最近 5 个开放岗位</h3>
            ${d.recentJobs.map((j) => `
              <div class="card">
                <dl class="kv">
                  <dt>职位</dt><dd>${esc(j.title)}</dd>
                  <dt>行业</dt><dd>${esc(j.industry || '—')}</dd>
                  <dt>薪资</dt><dd>${formatSalary(j.salary_min, j.salary_max)}</dd>
                </dl>
                <div>${j.required_skills.slice(0, 6).map((s) => `<span class="tag skill">${esc(s)}</span>`).join('')}</div>
              </div>
            `).join('')}
          </div>`}
    </div>

    <div class="card">
      <h2>🔒 For Candidates — 当前活跃 ${activeProUsers} 位专业用户</h2>
      <p>你的 PII 加密存储，只有你授权解锁后才能被对方看到</p>
      <p class="meta">候选人 Agent 可调 <code>GET /v1/candidate/opportunities</code> 查看匹配机会</p>

      <div class="card">
        <h3>▌隐私保护 4 步</h3>
        <div class="timeline">
          <div class="timeline-item done"><strong>1. 猎头上传时自动脱敏</strong> — industry / title_level / salary_range</div>
          <div class="timeline-item done"><strong>2. 雇主浏览只看到脱敏数据</strong> — 真实联系方式永远不可见</div>
          <div class="timeline-item done"><strong>3. 雇主表达兴趣时通知候选人</strong> — webhook 推送 + Agent 查询</div>
          <div class="timeline-item current"><strong>4. 候选人授权后才解锁联系方式</strong> — 你完全控制</div>
        </div>
      </div>
    </div>

    <p class="meta">数据更新于 ${esc(d.serverTime)} · 调用 <code>/v1/health</code> 查看实时状态</p>
  </main>
</body>
</html>`;
}