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

export interface HeadhunterRanking {
  rank: number;
  id: string;
  name: string;
  reputation: number;
}

export interface PlacementItem {
  title: string;
  industry: string | null;
  salaryText: string;
  headhunterName: string;
  at: string;
}

export interface LandingData {
  openJobsCount: number;
  publicCandidatesCount: number;
  industryGroups: IndustryGroup[];
  recentJobs: RecentJob[];
  activeEmployerCount: number;
  activeHeadhunterCount: number;
  serverTime: string;
  todayUnlocks: number;
  todayPlacements: number;
  totalCandidates: number;
  uptimePercent: number;
  topHeadhunters: HeadhunterRanking[];
  latestPlacements: PlacementItem[];
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
  <style>${LANDING_CSS}</style>
</head>
<body>
  <main>
    <header class="hero">
      <h1>🔍 Hunter Platform</h1>
      <p class="tagline"><strong>猎头中介 API 平台</strong> · 候选人隐私受保护 · 4 步解锁协议 · 20% 平台抽佣</p>
      <nav class="quicklinks">
        <a href="/v1/skill.md">📖 API 文档</a>
        <a href="/v1/openapi.json">📋 OpenAPI</a>
        <a href="/v1/health">🏥 Health</a>
        <a href="#for-employers">🏢 Employers</a>
        <a href="#for-headhunters">🎯 Headhunters</a>
      </nav>
    </header>

    ${renderHeroStats(d)}
    ${renderTopHeadhunters(d.topHeadhunters)}
    ${renderLatestPlacements(d.latestPlacements)}

    <div class="card" id="for-employers">
      <h2><span class="accent-bar"></span>🏢 For Employers — 在招岗位: ${d.openJobsCount}</h2>
      <p>浏览脱敏候选人池 → Agent 调 <code>GET /v1/employer/talent</code></p>
      ${renderEmployersBody(d)}
    </div>

    <div class="card" id="for-headhunters">
      <h2><span class="accent-bar"></span>🎯 For Headhunters — 今日可推荐: ${d.openJobsCount} 个开放岗位</h2>
      <p>上传候选人脱敏入库 → Agent 调 <code>POST /v1/headhunter/candidates</code></p>
      ${renderHeadhuntersBody(d)}
    </div>

    <div class="card" id="for-candidates">
      <h2><span class="accent-bar"></span>🔒 For Candidates — 当前活跃 ${activeProUsers} 位专业用户</h2>
      <p>你的 PII 加密存储，只有你授权解锁后才能被对方看到</p>
      <div class="timeline">
        <div class="timeline-item done"><strong>1. 猎头上传时自动脱敏</strong> — industry / title_level / salary_range</div>
        <div class="timeline-item done"><strong>2. 雇主浏览只看到脱敏数据</strong> — 真实联系方式永远不可见</div>
        <div class="timeline-item done"><strong>3. 雇主表达兴趣时通知候选人</strong> — webhook 推送 + Agent 查询</div>
        <div class="timeline-item current"><strong>4. 候选人授权后才解锁联系方式</strong> — 你完全控制</div>
      </div>
    </div>

    <p class="meta footer">数据更新于 ${esc(d.serverTime)} · 调用 <code>/v1/health</code> 查看实时状态</p>
  </main>
  ${LANDING_SCRIPT}
</body>
</html>`;
}

function renderHeroStats(d: LandingData): string {
  return `
    <div class="card hero-stats">
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-icon">🔓</div>
          <div class="stat-value" data-target="${d.todayUnlocks}">${d.todayUnlocks}</div>
          <div class="stat-label">今日解锁</div>
        </div>
        <div class="stat">
          <div class="stat-icon">🎯</div>
          <div class="stat-value" data-target="${d.todayPlacements}">${d.todayPlacements}</div>
          <div class="stat-label">今日 placements</div>
        </div>
        <div class="stat">
          <div class="stat-icon">👥</div>
          <div class="stat-value" data-target="${d.totalCandidates}">${d.totalCandidates}</div>
          <div class="stat-label">活跃候选人</div>
        </div>
        <div class="stat">
          <div class="stat-icon">⚡</div>
          <div class="stat-value">${d.uptimePercent}<span class="unit">%</span></div>
          <div class="stat-label">API uptime<span class="pulse-dot"></span></div>
        </div>
      </div>
    </div>
  `;
}

function renderTopHeadhunters(list: HeadhunterRanking[]): string {
  if (list.length === 0) return '';
  const medals = ['🥇', '🥈', '🥉'];
  return `
    <div class="card">
      <h2><span class="accent-bar"></span>🏆 Top 3 Headhunters</h2>
      ${list.map((h) => `
        <div class="ranking-row">
          <div class="ranking-medal">${medals[h.rank - 1]}</div>
          <div class="ranking-info">
            <div class="ranking-name">${esc(h.name)}</div>
            <div class="ranking-meta">reputation ${h.reputation}</div>
          </div>
          <div class="ranking-rep">${h.reputation}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderLatestPlacements(list: PlacementItem[]): string {
  if (list.length === 0) {
    return `<div class="card"><h2><span class="accent-bar"></span>🎯 Latest Placements</h2><p>暂无最近 placement 记录</p></div>`;
  }
  return `
    <div class="card">
      <h2><span class="accent-bar"></span>🎯 Latest 5 Placements</h2>
      ${list.map((p) => `
        <div class="placement-row">
          <div class="placement-title">${esc(p.title)} <span class="industry-tag">${esc(p.industry ?? '其他')}</span></div>
          <div class="placement-meta">
            <span class="placement-salary">¥${esc(p.salaryText)}</span>
            <span class="placement-hh">by ${esc(p.headhunterName)}</span>
            <span class="placement-time">${esc(p.at)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderEmployersBody(d: LandingData): string {
  if (d.publicCandidatesCount === 0) {
    return '<p class="meta">暂无公开候选人。<a href="/v1/skill.md">查看 skill.md</a> 了解如何注册 Agent。</p>';
  }
  return d.industryGroups.map((g) => `
    <div class="sub-card">
      <h3>▌${esc(g.industry || '其他')} (${g.candidates.length}人)</h3>
      ${g.candidates.slice(0, 3).map((c) => `
        <div class="candidate-card">
          <dl class="kv">
            <dt>职级</dt><dd>${esc(c.title_level || '—')}</dd>
            <dt>工作年限</dt><dd>${c.years_experience ?? '—'} 年</dd>
            <dt>薪资范围</dt><dd>${esc(c.salary_range || '—')}</dd>
            <dt>学历</dt><dd>${esc(c.education_tier || '—')}</dd>
          </dl>
          <div class="tags">${c.skills.slice(0, 6).map((s) => `<span class="tag skill">${esc(s)}</span>`).join('')}</div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderHeadhuntersBody(d: LandingData): string {
  if (d.recentJobs.length === 0) return '<p>暂无开放岗位。</p>';
  return `
    <div class="sub-card">
      <h3>▌最近 5 个开放岗位</h3>
      ${d.recentJobs.map((j) => `
        <div class="job-card">
          <div class="job-title">${esc(j.title)}</div>
          <div class="job-meta">
            <span class="industry-tag">${esc(j.industry || '—')}</span>
            <span class="salary">¥${formatSalary(j.salary_min, j.salary_max)}</span>
          </div>
          <div class="tags">${j.required_skills.slice(0, 6).map((s) => `<span class="tag skill">${esc(s)}</span>`).join('')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

const LANDING_CSS = `
:root {
  --brand-primary: #14b8a6;
  --brand-light: #5eead4;
  --brand-dark: #0f766e;
  --accent-warm: #f59e0b;
  --text-primary: #0f172a;
  --text-muted: #64748b;
  --bg-page: #f8fafc;
  --bg-card: #ffffff;
  --border: #e2e8f0;
  --shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-hover: 0 12px 28px rgba(15, 23, 42, 0.12);
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  margin: 0; padding: 24px;
  background: linear-gradient(180deg, #ecfeff 0%, var(--bg-page) 60%);
  background-attachment: fixed;
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}
main { max-width: 880px; margin: 0 auto; }
.hero { text-align: center; padding: 48px 24px; margin-bottom: 24px; animation: fadeInUp 0.6s ease-out; }
.hero h1 {
  font-size: 48px; margin: 0 0 12px;
  background: linear-gradient(135deg, var(--brand-dark), var(--brand-primary));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.hero .tagline { font-size: 16px; color: var(--text-muted); margin: 0 0 24px; }
.quicklinks { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.quicklinks a {
  text-decoration: none; color: var(--brand-dark);
  padding: 8px 16px; border: 1px solid var(--brand-primary);
  border-radius: 20px; font-size: 14px; transition: all 0.2s;
}
.quicklinks a:hover { background: var(--brand-primary); color: white; transform: translateY(-2px); }
.card {
  background: var(--bg-card); border-radius: 12px; padding: 24px;
  margin-bottom: 20px; box-shadow: var(--shadow);
  transition: all 0.3s; animation: fadeInUp 0.6s ease-out backwards;
}
.card:hover { box-shadow: var(--shadow-hover); }
.card h2 { margin-top: 0; display: flex; align-items: center; gap: 12px; font-size: 20px; }
.card h3 { font-size: 16px; color: var(--brand-dark); margin: 16px 0 12px; }
.accent-bar { display: inline-block; width: 4px; height: 20px; background: var(--brand-primary); border-radius: 2px; }
.hero-stats { background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%); border: 1px solid var(--brand-light); }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; text-align: center; }
.stat { padding: 16px; border-radius: 8px; transition: all 0.2s; }
.stat:hover { background: rgba(20, 184, 166, 0.06); transform: translateY(-2px); }
.stat-icon { font-size: 32px; margin-bottom: 8px; }
.stat-value {
  font-size: 36px; font-weight: 700; color: var(--brand-dark);
  margin-bottom: 4px; font-variant-numeric: tabular-nums;
}
.stat-value .unit { font-size: 18px; opacity: 0.7; }
.stat-label { font-size: 13px; color: var(--text-muted); }
.pulse-dot {
  display: inline-block; width: 6px; height: 6px;
  background: #22c55e; border-radius: 50%; margin-left: 6px;
  vertical-align: middle; animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.3); }
}
.ranking-row {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 16px; border-radius: 8px; margin: 8px 0; transition: all 0.2s;
}
.ranking-row:hover { background: rgba(20, 184, 166, 0.06); transform: translateX(4px); }
.ranking-medal { font-size: 28px; }
.ranking-info { flex: 1; }
.ranking-name { font-weight: 600; font-size: 16px; }
.ranking-meta { font-size: 13px; color: var(--text-muted); }
.ranking-rep { font-size: 20px; font-weight: 700; color: var(--brand-dark); font-variant-numeric: tabular-nums; }
.placement-row { padding: 12px 0; border-bottom: 1px solid var(--border); transition: all 0.2s; }
.placement-row:last-child { border-bottom: none; }
.placement-row:hover { background: rgba(20, 184, 166, 0.04); padding-left: 8px; }
.placement-title { font-weight: 600; margin-bottom: 4px; }
.industry-tag {
  display: inline-block; background: var(--brand-light); color: var(--brand-dark);
  padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-left: 8px;
}
.placement-meta { font-size: 13px; color: var(--text-muted); display: flex; gap: 16px; flex-wrap: wrap; }
.placement-salary { color: var(--accent-warm); font-weight: 600; }
.sub-card { background: var(--bg-page); border-radius: 8px; padding: 16px; margin: 12px 0; }
.candidate-card, .job-card { background: white; border-radius: 6px; padding: 12px 16px; margin: 8px 0; border: 1px solid var(--border); }
.kv { display: grid; grid-template-columns: 100px 1fr; gap: 4px 16px; margin: 8px 0; font-size: 14px; }
.kv dt { color: var(--text-muted); }
.kv dd { margin: 0; font-weight: 500; }
.tags { margin-top: 8px; }
.tag { display: inline-block; background: #f1f5f9; padding: 2px 10px; border-radius: 10px; font-size: 12px; margin: 2px; color: var(--text-muted); }
.tag.skill { background: #dbeafe; color: #1e40af; }
.timeline { padding-left: 24px; position: relative; margin-top: 16px; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: var(--brand-light); }
.timeline-item { position: relative; margin-bottom: 12px; font-size: 14px; }
.timeline-item::before {
  content: ''; position: absolute; left: -22px; top: 6px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--brand-primary); border: 2px solid white;
  box-shadow: 0 0 0 1px var(--brand-light);
}
.timeline-item.done::before { background: #22c55e; }
.timeline-item.current::before { background: var(--accent-warm); animation: pulse 1.5s ease-in-out infinite; }
.meta { color: var(--text-muted); font-size: 13px; }
.footer { text-align: center; padding: 24px; opacity: 0.7; }
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
.card:nth-child(2) { animation-delay: 0.1s; }
.card:nth-child(3) { animation-delay: 0.2s; }
.card:nth-child(4) { animation-delay: 0.3s; }
.card:nth-child(5) { animation-delay: 0.4s; }
.card:nth-child(6) { animation-delay: 0.5s; }
@media (max-width: 640px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .hero h1 { font-size: 36px; }
}
`;

const LANDING_SCRIPT = `
<script>
(function() {
  function countUp(el, target, duration) {
    const start = 0;
    const startTime = performance.now();
    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.floor(start + (target - start) * eased);
      el.textContent = value;
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }
  document.querySelectorAll('.stat-value[data-target]').forEach(function(el) {
    const target = parseInt(el.getAttribute('data-target'), 10) || 0;
    if (target > 0) countUp(el, target, 1500);
  });
  document.querySelectorAll('a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.style.animationPlayState = 'running';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.card').forEach(function(el) {
      el.style.animationPlayState = 'paused';
      observer.observe(el);
    });
  }
})();
</script>
<noscript>
  <style>.card { animation: none !important; }</style>
</noscript>
`;