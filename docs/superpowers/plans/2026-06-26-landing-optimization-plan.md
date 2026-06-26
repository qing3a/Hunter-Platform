# Landing Page Optimization Plan (P0/P1/P2 分类)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `localhost:3000/` (public landing, server-rendered HTML) across 10 small sub-tasks.

**Architecture:** All changes in `src/main/modules/view/templates/landing/*.ts` (string template rendering — no JS framework). Each sub-task is independent, single-commit, low-risk.

**Tech Stack:** TypeScript template strings + plain CSS. No build step for backend (Express serve already-rendered HTML).

---

## Priority Summary

| Priority | Sub-task | Component | Impact | Effort |
|----------|----------|-----------|--------|--------|
| P0.1 | Hero 3 角色 CTA | `hero.ts` | 转化 | 1.5h |
| P0.2 | SEO meta + og:tags | `layout.ts` / `index.ts` | 分享+SEO | 1h |
| P0.3 | "暂无 X" → "成为第一个" | 4 个 section | 0 数据不显破 | 1h |
| P1.4 | dark mode CSS | `landing.css.ts` | 阅读体验 | 1h |
| P1.5 | Footer capabilities 链接 | `footer.ts` | 开发者入口 | 20m |
| P1.6 | 4 步解锁后 CTA | `candidate-section.ts` | 候选人转化 | 30m |
| P2.7 | stats PII 标识 | `stats.ts` | 信任 | 20m |
| P2.9 | hero h1 主题 | `hero.ts` | 视觉聚焦 | (与 P0.1 合并) |
| P2.10 | aria-* 无障碍 | 多组件 | 无障碍 | 1h |

**Total: ~6-7 hours, 10 commits**

---

## File Structure

| File | Used by |
|------|---------|
| `src/main/modules/view/templates/landing/layout.ts` | P0.2 |
| `src/main/modules/view/templates/landing/index.ts` | P0.2 |
| `src/main/modules/view/templates/landing/hero.ts` | P0.1, P2.9 |
| `src/main/modules/view/templates/landing/landing.css.ts` | P0.1, P0.3, P1.4, P1.5, P1.6, P2.7, P2.10 |
| `src/main/modules/view/templates/landing/job-category-nav.ts` | P0.3 |
| `src/main/modules/view/templates/landing/featured-jobs.ts` | P0.3 |
| `src/main/modules/view/templates/landing/hot-companies.ts` | P0.3 |
| `src/main/modules/view/templates/landing/rankings.ts` | P0.3 |
| `src/main/modules/view/templates/landing/employer-section.ts` | P0.3 |
| `src/main/modules/view/templates/landing/headhunter-section.ts` | P0.3 |
| `src/main/modules/view/templates/landing/candidate-section.ts` | P1.6 |
| `src/main/modules/view/templates/landing/stats.ts` | P2.7 |
| `src/main/modules/view/templates/landing/footer.ts` | P1.5 |

---

## Sub-task P0.1: Hero 3 角色 CTA (合并 P2.9 h1 主题)

**Files:**
- Modify: `src/main/modules/view/templates/landing/hero.ts`
- Modify: `src/main/modules/view/templates/landing/landing.css.ts`

### Step 1: Add 3 角色 cards + h1 主题句

In `hero.ts`, replace the entire `<section class="hero">...</section>` with:

```html
<section class="hero">
  <h1>3 步解锁候选人隐私</h1>
  <p class="tagline">
    <strong>猎头中介 API 平台</strong> · 候选人 PII 加密 · 4 步解锁协议 · 20% 平台抽佣
  </p>

  <div class="role-anchors">
    <a class="role-card" href="#for-candidates">
      <span class="role-emoji">🔒</span>
      <h3 class="role-title">我是候选人</h3>
      <p class="role-desc">PII 加密存储，雇主浏览只看到脱敏数据</p>
      <span class="role-cta">了解隐私保护 →</span>
    </a>
    <a class="role-card" href="#for-headhunters">
      <span class="role-emoji">🎯</span>
      <h3 class="role-title">我是猎头</h3>
      <p class="role-desc">上传候选人 → 平台撮合 → 成交分 80% 佣金</p>
      <span class="role-cta">上传候选人 →</span>
    </a>
    <a class="role-card" href="#for-employers">
      <span class="role-emoji">💼</span>
      <h3 class="role-title">我是雇主</h3>
      <p class="role-desc">浏览脱敏候选人池 → 解锁联系方式 → 招到人</p>
      <span class="role-cta">浏览候选人 →</span>
    </a>
  </div>

  <details class="agent-gate">
    <summary>🤖 我是 AI Agent 开发者</summary>
    <ul class="agent-gate-list">
      <li>
        <code>GET /v1/skill.md</code>
        <a class="link-btn" href="/v1/skill.md" target="_blank" rel="noopener">打开 skill.md</a>
      </li>
      <li>
        <code>GET /v1/openapi.json</code>
        <a class="link-btn" href="/v1/openapi.json" target="_blank" rel="noopener">查看 OpenAPI</a>
      </li>
      <li>
        <code>GET /v1/health</code>
        <a class="link-btn" href="/v1/health" target="_blank" rel="noopener">查看状态</a>
      </li>
    </ul>
  </details>
</section>
```

### Step 2: CSS for role-anchors grid + role-card

In `landing.css.ts`, add:

```css
.role-anchors {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  max-width: 880px;
  margin: 32px auto 0;
}
.role-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 16px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  color: var(--text-primary);
  transition: all 0.2s;
}
.role-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  border-color: var(--brand-primary);
}
.role-emoji { font-size: 32px; margin-bottom: 8px; }
.role-title { margin: 0 0 8px; font-size: 16px; color: var(--brand-dark); }
.role-desc { margin: 0 0 16px; font-size: 13px; color: var(--text-muted); }
.role-cta { color: var(--brand-primary); font-weight: 600; font-size: 14px; }

@media (max-width: 640px) {
  .role-anchors { grid-template-columns: 1fr; }
}
```

### Step 3: Commit

```bash
git add src/main/modules/view/templates/landing/hero.ts src/main/modules/view/templates/landing/landing.css.ts
git commit -m "P0.1+P2.9: hero 3 role CTA cards + '3 步解锁' h1 theme (human-first landing)"
```

### Step 4: Verify

```bash
curl -s http://localhost:3000/ | grep -E "role-card|role-emoji" | head -3
```

Expected: see `<a class="role-card">` × 3 with emoji + title + desc + cta.

---

## Sub-task P0.2: SEO meta + og:tags

**Files:**
- Modify: `src/main/modules/view/templates/landing/layout.ts` (or `index.ts`)

### Step 1: Add meta tags in <head>

Find the layout function that emits `<head>`. Add after existing `<title>`:

```html
<meta name="description" content="AI Agent 与人类协作的猎头中介市场。候选人 PII 加密、4 步解锁协议、20% 平台抽佣。" />
<meta property="og:title" content="Hunter Platform · 猎头中介 API 平台" />
<meta property="og:description" content="AI Agent 与人类协作的猎头中介市场" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://html_qing3.top/" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="Hunter Platform · 猎头中介 API 平台" />
```

### Step 2: Commit

```bash
git add src/main/modules/view/templates/landing/layout.ts src/main/modules/view/templates/landing/index.ts
git commit -m "P0.2: <head> SEO meta + og:tags (social share preview + search ranking)"
```

### Step 3: Verify

```bash
curl -s http://localhost:3000/ | grep -E 'name="description"|property="og:title"' | head -3
```

Expected: 2+ matches.

---

## Sub-task P0.3: "暂无 X" → "成为第一个" (4 sections)

**Files:**
- Modify: `job-category-nav.ts`, `hot-companies.ts`, `employer-section.ts`, `headhunter-section.ts`
- Modify: `landing.css.ts` (add `.empty-state` CSS)

### Step 1: job-category-nav.ts

Find `<p class="meta">暂无分类数据</p>`. Replace with:

```html
<div class="empty-state">
  <p class="empty-state-text">暂无分类数据</p>
  <p class="empty-state-cta">想优先展示你的行业？<a href="#for-headhunters">上传候选人</a>激活分类</p>
</div>
```

### Step 2: hot-companies.ts

Find `<p class="meta">暂无热门企业</p>`. Replace with:

```html
<div class="empty-state">
  <p class="empty-state-text">暂无热门企业</p>
  <p class="empty-state-cta">完成第一笔 placement 后企业自动展示 → <a href="#for-employers">吸引企业</a></p>
</div>
```

### Step 3: employer-section.ts

Find `<p class="meta">暂无公开候选人...</p>`. Replace with:

```html
<div class="empty-state">
  <p class="empty-state-text">暂无公开候选人</p>
  <p class="empty-state-cta">想找候选人？<a href="/v1/skill.md#for-employers">查看 skill.md</a></p>
</div>
```

### Step 4: headhunter-section.ts

Find `<p>暂无开放岗位。</p>`. Replace with:

```html
<div class="empty-state">
  <p class="empty-state-text">暂无开放岗位</p>
  <p class="empty-state-cta">Agent 可调 <code>POST /v1/headhunter/jobs</code> 创建 → <a href="#for-employers">发布第一个岗位</a></p>
</div>
```

### Step 5: empty-state CSS in landing.css.ts

```css
.empty-state {
  text-align: center;
  padding: 32px 16px;
  background: var(--bg-page);
  border
