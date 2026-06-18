# Public Operations Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `GET /dashboard` — public SSR HTML page showing 4 aggregate sections (users, recommendations, API calls, activity feed) with NO PII.

**Architecture:** Single new route file + 1 new template. Direct DB queries (no new repos). Reuse shared CSS from view layer.

**Tech Stack:** TypeScript, Express, node:sqlite (existing), vitest (existing).

---

## File Structure

| File | Action |
|------|--------|
| `src/main/modules/view/templates/dashboard.ts` | Create — 4 section render functions |
| `src/main/routes/admin.ts` | Create — `GET /dashboard` handler |
| `src/main/server.ts` | Modify — register admin router |
| `tests/integration/dashboard.test.ts` | Create — 5 integration tests |

No DB migrations, no business logic changes.

---

## Existing Code Reference (READ BEFORE STARTING)

1. `src/main/modules/view/templates/shared-css.ts` — reusable CSS classes (`card`, `kv`, `tag`, etc.)
2. `src/main/db/connection.ts` — `openDb(path)` returns DB with prepared-statement API
3. `src/main/db/repositories/users.ts` — see users table columns
4. `src/main/db/repositories/recommendations.ts` — see recommendations table columns (status enum)
5. `src/main/server.ts` — see how other routers are registered (`app.use('/v1/...', createRouter(db))`)

---

## Task 1: Dashboard template (pure render functions)

**Files:**
- Create: `src/main/modules/view/templates/dashboard.ts`

- [ ] **Step 1: Create dashboard template**

Create `src/main/modules/view/templates/dashboard.ts`:

```typescript
import { SHARED_CSS } from './shared-css.js';

export interface UserCounts { candidate: number; headhunter: number; employer: number; }
export interface CandidateCounts { total: number; publicPool: number; }
export interface RecommendationCounts { [status: string]: number; }
export interface EndpointCounts { [actionType: string]: number; }
export interface RecentActivity {
  at: string;
  action_type: string;
  status: string;
}

export interface DashboardData {
  users: UserCounts;
  candidates: CandidateCounts;
  recommendations: RecommendationCounts;
  totalRecommendations: number;
  endpointsToday: EndpointCounts;
  totalEndpointsToday: number;
  recentActivity: RecentActivity[];
  serverTime: string;
  uptimeHours: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const RECOMMENDATION_STATUSES = [
  'pending', 'employer_interested', 'candidate_approved', 'unlocked', 'placed',
  'rejected_employer', 'rejected_candidate', 'withdrawn',
];

export function renderDashboard(d: DashboardData): string {
  const totalUsers = d.users.candidate + d.users.headhunter + d.users.employer;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Hunter Platform · Operations Dashboard</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main>
    <h1>Hunter Platform · Operations Dashboard</h1>
    <p class="meta">🟢 Healthy · ${esc(d.serverTime)} UTC · uptime ${d.uptimeHours.toFixed(1)}h</p>

    <div class="card">
      <h2>Users &amp; Candidates</h2>
      <dl class="kv">
        <dt>Total users</dt><dd>${totalUsers}</dd>
        <dt>├─ candidate</dt><dd>${d.users.candidate}</dd>
        <dt>├─ headhunter</dt><dd>${d.users.headhunter}</dd>
        <dt>└─ employer</dt><dd>${d.users.employer}</dd>
        <dt>Anonymized candidates</dt><dd>${d.candidates.total}</dd>
        <dt>├─ Public pool</dt><dd>${d.candidates.publicPool}</dd>
      </dl>
    </div>

    <div class="card">
      <h2>Recommendation Pipeline</h2>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="text-align:left; color:#718096; font-size:13px;">
          <th>Status</th><th>Count</th>
        </tr></thead>
        <tbody>
          ${RECOMMENDATION_STATUSES.map(s => `
            <tr>
              <td>${esc(s)}</td>
              <td>${d.recommendations[s] ?? 0}</td>
            </tr>`).join('')}
          <tr style="border-top: 2px solid #e2e8f0; font-weight: bold;">
            <td>Total</td><td>${d.totalRecommendations}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>API Calls Today</h2>
      <dl class="kv">
        <dt>Total</dt><dd>${d.totalEndpointsToday}</dd>
      </dl>
      ${Object.keys(d.endpointsToday).length === 0
        ? '<p class="meta">No calls today yet.</p>'
        : `<table style="width:100%; border-collapse: collapse; margin-top: 8px;">
            <thead><tr style="text-align:left; color:#718096; font-size:13px;">
              <th>Action</th><th>Count</th>
            </tr></thead>
            <tbody>
              ${Object.entries(d.endpointsToday)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => `<tr><td><code>${esc(action)}</code></td><td>${count}</td></tr>`)
                .join('')}
            </tbody>
          </table>`}
    </div>

    <div class="card">
      <h2>Recent Activity (last 20)</h2>
      ${d.recentActivity.length === 0
        ? '<p class="meta">No activity yet.</p>'
        : `<table style="width:100%; border-collapse: collapse; font-size: 13px;">
            <thead><tr style="text-align:left; color:#718096;">
              <th>Time</th><th>Action</th><th>Status</th>
            </tr></thead>
            <tbody>
              ${d.recentActivity.map(a => `
                <tr>
                  <td>${esc(a.at.split('T')[1]?.slice(0, 8) ?? a.at)}</td>
                  <td><code>${esc(a.action_type)}</code></td>
                  <td>${esc(a.status)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          <p class="meta">匿名 feed：不含 user_id / target_id</p>`}
    </div>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 2: Sanity check typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: exit 0 (template uses known types).

---

## Task 2: Admin router with data queries

**Files:**
- Create: `src/main/routes/admin.ts`

- [ ] **Step 1: Create admin router**

Create `src/main/routes/admin.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import type { DB } from '../db/connection.js';
import { renderDashboard, type DashboardData } from '../modules/view/templates/dashboard.js';

// Captured at startup so uptime is accurate relative to process start.
const SERVER_START = Date.now();

export function createAdminRouter(db: DB): Router {
  const router = Router();

  // GET /dashboard — public, no auth, no quota
  router.get('/dashboard', (_req: Request, res: Response) => {
    try {
      const data = gatherDashboardData(db);
      const html = renderDashboard(data);
      res.status(200).type('text/html; charset=utf-8').send(html);
    } catch (e) {
      console.error('Dashboard render failed:', e);
      res.status(500).type('text/html; charset=utf-8')
        .send(`<!DOCTYPE html><html><body><h1>Dashboard 暂不可用</h1><p>${(e as Error).message}</p></body></html>`);
    }
  });

  return router;
}

function gatherDashboardData(db: DB): DashboardData {
  // Users by type
  const userRows = db.prepare(
    `SELECT user_type, COUNT(*) as count FROM users WHERE status = 'active' GROUP BY user_type`
  ).all() as Array<{ user_type: string; count: number }>;
  const users = { candidate: 0, headhunter: 0, employer: 0 };
  for (const r of userRows) {
    if (r.user_type in users) (users as any)[r.user_type] = r.count;
  }

  // Candidates
  const candRow = db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN is_public_pool = 1 THEN 1 ELSE 0 END) as public_pool
     FROM candidates_anonymized`
  ).get() as { total: number; public_pool: number | null };
  const candidates = { total: candRow.total, publicPool: candRow.public_pool ?? 0 };

  // Recommendations by status
  const recRows = db.prepare(
    `SELECT status, COUNT(*) as count FROM recommendations GROUP BY status`
  ).all() as Array<{ status: string; count: number }>;
  const recommendations: { [s: string]: number } = {};
  let totalRecommendations = 0;
  for (const r of recRows) {
    recommendations[r.status] = r.count;
    totalRecommendations += r.count;
  }

  // API calls today (action_history)
  const actionRows = db.prepare(
    `SELECT action_type, COUNT(*) as count
     FROM action_history
     WHERE created_at >= datetime('now', 'start of day')
     GROUP BY action_type
     ORDER BY count DESC`
  ).all() as Array<{ action_type: string; count: number }>;
  const endpointsToday: { [s: string]: number } = {};
  let totalEndpointsToday = 0;
  for (const r of actionRows) {
    endpointsToday[r.action_type] = r.count;
    totalEndpointsToday += r.count;
  }

  // Recent activity (last 20, anonymized — NO user_id / target_id)
  const recentRows = db.prepare(
    `SELECT created_at, action_type, status
     FROM action_history
     ORDER BY created_at DESC
     LIMIT 20`
  ).all() as Array<{ created_at: string; action_type: string; status: string }>;
  const recentActivity = recentRows.map(r => ({
    at: r.created_at,
    action_type: r.action_type,
    status: r.status,
  }));

  return {
    users,
    candidates,
    recommendations,
    totalRecommendations,
    endpointsToday,
    totalEndpointsToday,
    recentActivity,
    serverTime: new Date().toISOString(),
    uptimeHours: (Date.now() - SERVER_START) / 3600_000,
  };
}
```

- [ ] **Step 2: Register admin router in server.ts**

Open `src/main/server.ts`. Find the section with other `app.use('/v1/...', createRouter(db))` lines. Add:

```typescript
app.use(createAdminRouter(db));
```

(Without a path prefix — the route inside uses `/dashboard`.)

Or, if you want it under `/admin`:

```typescript
app.use('/admin', createAdminRouter(db));
```

…and update the route in admin.ts to `router.get('/', ...)`. **Pick one** and be consistent. **Recommended**: mount at root path so the URL is `GET /dashboard` (more memorable, fits the "single public dashboard page" mental model).

- [ ] **Step 3: Run typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck 2>&1 | tail -3`
Expected: exit 0.

---

## Task 3: Integration tests

**Files:**
- Create: `tests/integration/dashboard.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/dashboard.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /dashboard', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890');
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 + HTML with all 4 sections', async () => {
    const app = createApp();
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('Operations Dashboard');
    expect(res.text).toContain('Users &amp; Candidates');
    expect(res.text).toContain('Recommendation Pipeline');
    expect(res.text).toContain('API Calls Today');
    expect(res.text).toContain('Recent Activity');
  });

  it('reflects actual user counts after registrations', async () => {
    const app = createApp();
    // Register 2 candidates, 1 headhunter
    await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C1', contact: 'c1@c.com' });
    await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'C2', contact: 'c2@c.com' });
    await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'H1', contact: 'h1@h.com' });

    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    // Should show 3 total users with 2 candidates + 1 headhunter
    expect(res.text).toMatch(/Total users[\s\S]{0,200}<dd>3<\/dd>/);
  });

  it('does NOT include any PII (no user_id, contact, email)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'employer', name: 'PII Test', contact: 'secret@private.com',
    });

    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('secret@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);  // no user IDs leaked
    expect(res.text).not.toContain('PII Test');  // names also not leaked (privacy choice)
  });

  it('is accessible WITHOUT auth (public endpoint)', async () => {
    const app = createApp();
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);  // not 401
  });

  it('survives empty DB (shows zeros, not errors)', async () => {
    const app = createApp();
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<dd>0</dd>');  // at least one zero count visible
    expect(res.text).toContain('No calls today yet');  // empty state for endpoints
  });
});
```

- [ ] **Step 2: Run test to verify GREEN**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/dashboard.test.ts 2>&1 | tail -10`
Expected: PASS — 5 tests.

If anything fails, debug per the TDD skill:
1. Re-read the error
2. Check that admin router is actually registered
3. Verify response shape

- [ ] **Step 3: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/modules/view/templates/dashboard.ts src/main/routes/admin.ts src/main/server.ts tests/integration/dashboard.test.ts
git commit -m "feat(admin): add public GET /dashboard (4-section aggregate stats)

Sections: users, recommendations pipeline, API calls today, recent activity.
Public (no auth, no quota). No PII — only aggregate counts and anonymized feed."
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: typecheck + full test suite**

```bash
cd D:\dev\hunter-platform && pnpm typecheck
cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5
```

Expected: typecheck exit 0; 298 + 5 = ~303 tests pass.

- [ ] **Step 2: Live smoke test**

```bash
# Kill any existing server
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3

# Start server
cd D:\dev\hunter-platform && pnpm api:dev > tmp/dashboard-smoke.log 2>&1 &
sleep 5
cat D:/dev/hunter-platform/tmp/dashboard-smoke.log | tail -2
```

```bash
# Smoke test (no auth required)
curl -sS -w "\n[%{http_code}] content-type=%{content_type}\n" "http://localhost:3000/dashboard" 2>&1 | head -50
```

Expected: HTTP 200, content-type text/html, page contains "Operations Dashboard", "Users & Candidates", etc.

- [ ] **Step 3: Kill server**

```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3
```

- [ ] **Step 4: Push to remote**

```bash
cd D:\dev-hunter-platform && git push origin main
```

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| §2 visual layout | T1 |
| §3.1 users & candidates query | T2 (gatherDashboardData) |
| §3.2 recommendations query | T2 |
| §3.3 API calls today query | T2 |
| §3.4 recent activity query | T2 |
| §7 testing strategy | T3 |
| §8 implementation path | T1-T4 |

**Placeholder scan:** No TBD/TODO. T1 Step 1 is full template code. T2 Step 1 is full router code. T3 Step 1 is full test code.

**Type consistency:** `DashboardData` interface defined in T1, used in T2 router, tested in T3. `DB` type from connection module imported consistently.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-public-dashboard.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch fresh subagent per task
2. **Inline Execution** - execute tasks in this session with checkpoints

Expected scope: ~200 lines code (template + router + 5 tests). 1 commit. Total work time ~30 min.