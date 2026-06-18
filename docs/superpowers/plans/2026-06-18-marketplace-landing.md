# Marketplace Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Replace `GET /dashboard` (ops metrics) with `GET /` (marketplace landing page) — public SSR HTML showing real candidate/job data as social proof for the 3 user types.

**Architecture:** Delete dashboard files; create new landing template + admin router serving `/`. No DB schema changes, no new dependencies.

**Tech Stack:** TypeScript, Express, node:sqlite (existing), vitest (existing).

---

## File Structure

| File | Action |
|------|--------|
| `src/main/modules/view/templates/dashboard.ts` | **Delete** |
| `src/main/routes/admin.ts` | **Delete** |
| `tests/integration/dashboard.test.ts` | **Delete** |
| `src/main/modules/view/templates/landing.ts` | Create |
| `src/main/routes/landing.ts` | Create |
| `src/main/server.ts` | Modify — register landing router at root |
| `tests/integration/landing.test.ts` | Create |

---

## Task 1: Delete dashboard files

- [ ] **Step 1: Remove dashboard artifacts**

```bash
cd D:\dev\hunter-platform
git rm src/main/modules/view/templates/dashboard.ts
git rm src/main/routes/admin.ts
git rm tests/integration/dashboard.test.ts
```

- [ ] **Step 2: Commit deletion**

```bash
cd D:\dev\hunter-platform
git commit -m "chore(dashboard): remove ops dashboard (replaced by marketplace landing)"
```

**Do NOT push yet** — Task 3 will modify server.ts and needs a coherent commit.

---

## Task 2: Create landing template + router

**Files:**
- Create: `src/main/modules/view/templates/landing.ts`
- Create: `src/main/routes/landing.ts`

- [ ] **Step 1: Read shared CSS for patterns**

```bash
cat src/main/modules/view/templates/shared-css.ts
```

- [ ] **Step 2: Create `src/main/modules/view/templates/landing.ts`**

```typescript
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
```

- [ ] **Step 3: Create `src/main/routes/landing.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import type { DB } from '../db/connection.js';
import { renderLanding, type CandidateCard, type IndustryGroup, type RecentJob, type LandingData } from '../modules/view/templates/landing.js';

export function createLandingRouter(db: DB): Router {
  const router = Router();

  // GET / — public marketplace landing page (no auth, no quota)
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = gatherLandingData(db);
      const html = renderLanding(data);
      res.status(200).type('text/html; charset=utf-8').send(html);
    } catch (e) {
      console.error('Landing render failed:', e);
      const fallback = `<!DOCTYPE html><html lang="zh-CN"><body><main><h1>Hunter Platform</h1><p>暂不可用</p></main></body></html>`;
      res.status(500).type('text/html; charset=utf-8').send(fallback);
    }
  });

  return router;
}

function gatherLandingData(db: DB): LandingData {
  const openJobsRow = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'open'`).get() as { c: number };

  const pubCandRow = db.prepare(`SELECT COUNT(*) as c FROM candidates_anonymized WHERE is_public_pool = 1`).get() as { c: number };

  const candRows = db.prepare(`
    SELECT anonymized_id, industry, title_level, years_experience, salary_range, education_tier, skills_json
    FROM candidates_anonymized
    WHERE is_public_pool = 1 AND industry IS NOT NULL
    ORDER BY industry, created_at DESC
  `).all() as Array<{
    anonymized_id: string; industry: string; title_level: string | null;
    years_experience: number | null; salary_range: string | null;
    education_tier: string | null; skills_json: string | null;
  }>;

  const byIndustry = new Map<string, CandidateCard[]>();
  for (const r of candRows) {
    if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
    const list = byIndustry.get(r.industry)!;
    if (list.length < 5) {
      list.push({
        anonymized_id: r.anonymized_id,
        industry: r.industry,
        title_level: r.title_level,
        years_experience: r.years_experience,
        salary_range: r.salary_range,
        education_tier: r.education_tier,
        skills: r.skills_json ? safeParseSkills(r.skills_json) : [],
      });
    }
  }
  const industryGroups: IndustryGroup[] = Array.from(byIndustry.entries())
    .map(([industry, candidates]) => ({ industry, candidates }))
    .sort((a, b) => b.candidates.length - a.candidates.length);

  const jobRows = db.prepare(`
    SELECT title, industry, salary_min, salary_max, required_skills_json
    FROM jobs WHERE status = 'open'
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{
    title: string; industry: string | null;
    salary_min: number | null; salary_max: number | null;
    required_skills_json: string | null;
  }>;
  const recentJobs: RecentJob[] = jobRows.map((r) => ({
    title: r.title,
    industry: r.industry,
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    required_skills: r.required_skills_json ? safeParseSkills(r.required_skills_json) : [],
  }));

  const userRows = db.prepare(`
    SELECT user_type, COUNT(*) as c FROM users
    WHERE status = 'active' AND user_type IN ('headhunter', 'employer')
    GROUP BY user_type
  `).all() as Array<{ user_type: string; c: number }>;
  let activeEmployerCount = 0;
  let activeHeadhunterCount = 0;
  for (const r of userRows) {
    if (r.user_type === 'employer') activeEmployerCount = r.c;
    if (r.user_type === 'headhunter') activeHeadhunterCount = r.c;
  }

  return {
    openJobsCount: openJobsRow.c,
    publicCandidatesCount: pubCandRow.c,
    industryGroups,
    recentJobs,
    activeEmployerCount,
    activeHeadhunterCount,
    serverTime: new Date().toISOString(),
  };
}

function safeParseSkills(json: string): string[] {
  try { return JSON.parse(json) as string[]; } catch { return []; }
}
```

---

## Task 3: Register landing router in server.ts

- [ ] **Step 1: Update server.ts**

Find and **remove**:
```typescript
app.use(createAdminRouter(db));
import { createAdminRouter } from './routes/admin.js';
```

Find and **add**:
```typescript
app.use(createLandingRouter(db));
import { createLandingRouter } from './routes/landing.js';
```

- [ ] **Step 2: Run typecheck**

```bash
cd D:\dev\hunter-platform && pnpm typecheck
```

Expected: exit 0.

---

## Task 4: Integration tests

**Files:**
- Create: `tests/integration/landing.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / (marketplace landing)', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 + HTML', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
  });

  it('contains hero + 3 role sections', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('Hunter Platform');
    expect(res.text).toContain('For Employers');
    expect(res.text).toContain('For Headhunters');
    expect(res.text).toContain('For Candidates');
  });

  it('shows real open job count', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'E1', contact: 'e1@e.com' });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Job 1' });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`)
      .send({ title: 'Job 2' });

    const res = await request(app).get('/');
    expect(res.text).toMatch(/在招岗位[\s\S]{0,100}2/);
  });

  it('shows candidate data after upload + publish', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' });
    const cand = await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' });
    const upload = await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: '字节跳动', current_title: 'P6',
        expected_salary: 600000, years_experience: 5,
        education_school: 'S', skills: ['React'],
      });
    await request(app).post(`/v1/headhunter/candidates/${upload.body.data.anonymized_id}/publish-to-pool`)
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);

    const res = await request(app).get('/');
    expect(res.text).toContain('互联网');
  });

  it('does NOT include any PII', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'leaked@private.com',
    });
    const res = await request(app).get('/');
    expect(res.text).not.toContain('leaked@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
  });

  it('handles empty DB gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hunter Platform');
  });

  it('is accessible WITHOUT auth', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd D:\dev\hunter-platform && pnpm test -- tests/integration/landing.test.ts 2>&1 | tail -10
```

Expected: 7 tests pass.

- [ ] **Step 3: Full suite + typecheck**

```bash
cd D:\dev\hunter-platform && pnpm typecheck
cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5
```

Expected: clean typecheck, ~305 tests pass (303 - 5 dashboard + 7 landing).

---

## Task 5: Smoke test + commit + push

- [ ] **Step 1: Live smoke test**

```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3
cd D:\dev\hunter-platform && pnpm api:dev > tmp/landing-smoke.log 2>&1 &
sleep 5

curl -sS -w "\n[%{http_code}] content-type=%{content_type}\n" "http://localhost:3000/" 2>&1 | tail -3
curl -sS "http://localhost:3000/" 2>&1 | grep -oE "For (Employers|Headhunters|Candidates)" | sort -u
```

Expected: HTTP 200, 3 sections present.

- [ ] **Step 2: Kill server + commit + push**

```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3

cd D:\dev\hunter-platform
git add -A
git commit -m "feat(landing): replace /dashboard with / marketplace landing

Public SSR HTML showing:
- Hero + 3 role-targeted sections (Employers / Headhunters / Candidates)
- Real candidate data grouped by industry (top 5 per industry)
- Recent 5 open jobs with required_skills
- 4-step privacy protection timeline

Removes the old ops dashboard (was aggregate stats, not useful for visitors).
No PII exposed. No auth required."
git push origin main
```

---

## Self-Review

- Spec coverage: T1 (delete) + T2 (create) + T3 (wire) + T4 (test) + T5 (smoke)
- No placeholders. T2 Step 2 + T4 Step 1 are full code.
- Type consistency: `LandingData`, `CandidateCard`, `IndustryGroup`, `RecentJob` consistent.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-18-marketplace-landing.md`. Two options:

1. Subagent-Driven (recommended)
2. Inline Execution

Estimated: 1-2 commits, ~300 lines, ~30 min.