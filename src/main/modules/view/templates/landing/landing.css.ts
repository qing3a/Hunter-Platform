// src/main/modules/view/templates/landing/landing.css.ts

export const LANDING_CSS = `
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
  --nav-height: 64px;
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  margin: 0; padding: 0;
  background: linear-gradient(180deg, #ecfeff 0%, var(--bg-page) 60%);
  background-attachment: fixed;
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}
main { max-width: 880px; margin: 0 auto; padding: 24px; }

/* Top nav */
.top-nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: saturate(180%) blur(8px);
  -webkit-backdrop-filter: saturate(180%) blur(8px);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
}
.nav-inner {
  max-width: 880px; margin: 0 auto;
  display: flex; align-items: center; gap: 16px;
  padding: 12px 24px; min-height: var(--nav-height);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; color: var(--brand-dark); font-weight: 700; font-size: 18px; }
.brand-mark { font-size: 24px; }
.status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: white; border: 1px solid var(--border); border-radius: 20px; font-size: 13px; font-weight: 600; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; }
.unit { font-size: 0.7em; opacity: 0.7; }
.nav-links { display: flex; gap: 12px; flex: 1; flex-wrap: wrap; }
.nav-links a { text-decoration: none; color: var(--text-muted); font-size: 13px; padding: 4px 8px; border-radius: 4px; transition: all 0.2s; }
.nav-links a:hover { color: var(--brand-dark); background: rgba(20, 184, 166, 0.08); }
.copy-btn {
  padding: 6px 14px; background: var(--brand-primary); color: white;
  border: none; border-radius: 6px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.copy-btn:hover { background: var(--brand-dark); transform: translateY(-1px); }
.copy-btn.copied { background: #22c55e; }

/* Role anchors */
.role-anchors {
  display: flex; gap: 12px; justify-content: center;
  padding: 20px 24px; background: white;
  border-bottom: 1px solid var(--border);
  position: sticky; top: var(--nav-height); z-index: 99;
}
.role-anchor {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; background: var(--bg-page);
  border: 1px solid var(--border); border-radius: 20px;
  text-decoration: none; color: var(--text-primary);
  font-size: 14px; font-weight: 500;
  transition: all 0.2s;
}
.role-anchor:hover { background: var(--brand-light); color: var(--brand-dark); border-color: var(--brand-primary); transform: translateY(-1px); }
.role-anchor.active { background: var(--brand-primary); color: white; border-color: var(--brand-primary); }
.role-emoji { font-size: 18px; }

/* Hero */
.hero { text-align: center; padding: 48px 24px 32px; margin-bottom: 24px; animation: fadeInUp 0.6s ease-out; }
.hero h1 { font-size: 48px; margin: 0 0 12px; background: linear-gradient(135deg, var(--brand-dark), var(--brand-primary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.hero .tagline { font-size: 16px; color: var(--text-muted); margin: 0 0 24px; }

/* Agent Gate */
.agent-gate {
  max-width: 640px; margin: 0 auto;
  background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%);
  border: 2px solid var(--brand-light);
  border-radius: 12px; padding: 20px 24px;
  text-align: left;
}
.agent-gate-header { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; color: var(--brand-dark); margin-bottom: 12px; }
.agent-gate-emoji { font-size: 24px; }
.agent-gate-list { list-style: none; padding: 0; margin: 0; }
.agent-gate-list li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.agent-gate-list li:last-child { border-bottom: none; }
.agent-gate-list code { flex: 1; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; color: var(--text-primary); }
.link-btn { padding: 4px 10px; background: white; border: 1px solid var(--brand-primary); color: var(--brand-dark); text-decoration: none; border-radius: 4px; font-size: 13px; }
.link-btn:hover { background: var(--brand-light); }

/* Cards */
.card { background: var(--bg-card); border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: var(--shadow); transition: all 0.3s; animation: fadeInUp 0.6s ease-out backwards; }
.card:hover { box-shadow: var(--shadow-hover); }
.card h2 { margin-top: 0; display: flex; align-items: center; gap: 12px; font-size: 20px; }
.card h3 { font-size: 16px; color: var(--brand-dark); margin: 16px 0 12px; }
.accent-bar { display: inline-block; width: 4px; height: 20px; background: var(--brand-primary); border-radius: 2px; }
.hero-stats { background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%); border: 1px solid var(--brand-light); }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; text-align: center; }
.stat { padding: 16px; border-radius: 8px; transition: all 0.2s; }
.stat:hover { background: rgba(20, 184, 166, 0.06); transform: translateY(-2px); }
.stat-icon { font-size: 32px; margin-bottom: 8px; }
.stat-value { font-size: 36px; font-weight: 700; color: var(--brand-dark); margin-bottom: 4px; font-variant-numeric: tabular-nums; }
.stat-label { font-size: 13px; color: var(--text-muted); }
.pulse-dot { display: inline-block; width: 6px; height: 6px; background: #22c55e; border-radius: 50%; margin-left: 6px; vertical-align: middle; animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.3); } }

/* Rankings */
.ranking-tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--border); margin-bottom: 16px; overflow-x: auto; }
.ranking-tab { background: none; border: none; padding: 10px 16px; font-size: 14px; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; white-space: nowrap; }
.ranking-tab:hover { color: var(--brand-dark); }
.ranking-tab.active { color: var(--brand-dark); border-bottom-color: var(--brand-primary); font-weight: 600; }
.ranking-panel[hidden] { display: none; }

/* Ranking rows */
.ranking-row { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-radius: 8px; margin: 8px 0; transition: all 0.2s; }
.ranking-row:hover { background: rgba(20, 184, 166, 0.06); transform: translateX(4px); }
.ranking-medal { font-size: 28px; min-width: 36px; text-align: center; }
.ranking-info { flex: 1; }
.ranking-name { font-weight: 600; font-size: 16px; }
.ranking-meta { font-size: 13px; color: var(--text-muted); }
.ranking-rep { font-size: 20px; font-weight: 700; color: var(--brand-dark); font-variant-numeric: tabular-nums; }

/* Placements */
.placement-row { padding: 12px 0; border-bottom: 1px solid var(--border); transition: all 0.2s; }
.placement-row:last-child { border-bottom: none; }
.placement-row:hover { background: rgba(20, 184, 166, 0.04); padding-left: 8px; }
.placement-title { font-weight: 600; margin-bottom: 4px; }
.industry-tag { display: inline-block; background: var(--brand-light); color: var(--brand-dark); padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-left: 8px; }
.placement-meta { font-size: 13px; color: var(--text-muted); display: flex; gap: 16px; flex-wrap: wrap; }
.placement-salary { color: var(--accent-warm); font-weight: 600; }

/* Sub-cards */
.sub-card { background: var(--bg-page); border-radius: 8px; padding: 16px; margin: 12px 0; }
.candidate-card, .job-card { background: white; border-radius: 6px; padding: 12px 16px; margin: 8px 0; border: 1px solid var(--border); }
.kv { display: grid; grid-template-columns: 100px 1fr; gap: 4px 16px; margin: 8px 0; font-size: 14px; }
.kv dt { color: var(--text-muted); }
.kv dd { margin: 0; font-weight: 500; }
.tags { margin-top: 8px; }
.tags-block { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { display: inline-block; background: #f1f5f9; padding: 2px 10px; border-radius: 10px; font-size: 12px; margin: 2px; color: var(--text-muted); }
.tag.skill { background: #dbeafe; color: #1e40af; }

/* Timeline */
.timeline { padding-left: 24px; position: relative; margin-top: 16px; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: var(--brand-light); }
.timeline-item { position: relative; margin-bottom: 12px; font-size: 14px; }
.timeline-item::before { content: ''; position: absolute; left: -22px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--brand-primary); border: 2px solid white; box-shadow: 0 0 0 1px var(--brand-light); }
.timeline-item.done::before { background: #22c55e; }
.timeline-item.current::before { background: var(--accent-warm); animation: pulse 1.5s ease-in-out infinite; }

/* Footer */
.site-footer { background: var(--bg-page); border-top: 1px solid var(--border); padding: 32px 24px; text-align: center; margin-top: 40px; }
.footer-links { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }
.footer-links a { text-decoration: none; color: var(--brand-dark); font-size: 14px; }
.footer-links a:hover { text-decoration: underline; }
.footer-brand { font-size: 14px; color: var(--text-muted); margin: 8px 0; }
.footer-time { font-size: 12px; }

.meta { color: var(--text-muted); font-size: 13px; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 640px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .hero h1 { font-size: 36px; }
  .nav-links { gap: 8px; }
  .role-anchors { gap: 6px; padding: 12px; }
  .role-anchor { padding: 6px 10px; font-size: 13px; }
}

/* ===== v4: 职位分类导航 ===== */
.job-category-nav .job-category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.job-category-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 12px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-decoration: none;
  color: #1a202c;
  transition: all 0.2s;
}
.job-category-item:hover {
  background: #edf2f7;
  border-color: #14b8a6;
  transform: translateY(-2px);
}
.job-category-emoji {
  font-size: 28px;
  margin-bottom: 8px;
}
.job-category-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.job-category-count {
  font-size: 12px;
  color: #718096;
}

/* ===== v4: 精选/热招职位 ===== */
.featured-jobs-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.featured-job-card {
  padding: 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.2s;
}
.featured-job-card:hover {
  border-color: #14b8a6;
  box-shadow: 0 4px 12px rgba(20, 184, 166, 0.1);
}
.featured-job-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.badge-urgent {
  background: #fc8181;
  color: #ffffff;
}
.badge-hot {
  background: #f6ad55;
  color: #ffffff;
}
.featured-job-salary {
  font-size: 18px;
  font-weight: 700;
  color: #14b8a6;
  margin-left: auto;
}
.featured-job-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 6px;
}
.featured-job-meta {
  font-size: 13px;
  color: #4a5568;
  margin-bottom: 10px;
}
.featured-job-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.featured-jobs-more {
  margin-top: 16px;
  text-align: right;
  color: #a0aec0;
  font-size: 13px;
}

/* ===== v4: 热门企业 ===== */
.hot-companies-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.hot-company-card {
  padding: 16px;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.hot-company-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e2e8f0;
}
.hot-company-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
}
.hot-company-count {
  font-size: 12px;
  color: #14b8a6;
  background: #f0fdfa;
  padding: 2px 8px;
  border-radius: 4px;
}
.hot-company-jobs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hot-company-job {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #4a5568;
}
.hot-company-job-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hot-company-job-salary {
  color: #14b8a6;
  font-weight: 600;
  white-space: nowrap;
  margin-left: 8px;
}
.hot-company-more {
  margin-top: 12px;
  text-align: right;
  color: #a0aec0;
  font-size: 12px;
}

/* ===== v4: 响应式 ===== */
@media (max-width: 1023px) {
  .hot-companies-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 767px) {
  .featured-jobs-grid {
    grid-template-columns: 1fr;
  }
  .hot-companies-grid {
    grid-template-columns: 1fr;
  }
  .job-category-nav .job-category-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
`.trim();