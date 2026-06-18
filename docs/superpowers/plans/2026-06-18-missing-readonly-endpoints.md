# Missing Read-Only Endpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add 5 missing read-only endpoints from skill.md §3.3 / §3.5: `/v1/config/{industries,title_levels,salary_bands}`, `/v1/market/leaderboard`, `/v1/headhunter/candidates`.

**Architecture:** New route files `routes/config.ts` and `routes/market.ts`; one additional handler in `routes/headhunter.ts`. All endpoints reuse existing desensitize mappings and DB queries. No new dependencies.

**Tech Stack:** TypeScript, Express, better-sqlite3 (existing), vitest, supertest (existing).

---

## File Structure

| File | Action |
|------|--------|
| `src/main/routes/config.ts` | Create — 3 config endpoints |
| `src/main/routes/market.ts` | Create — leaderboard |
| `src/main/routes/headhunter.ts` | Modify — add `GET /candidates` |
| `src/main/server.ts` | Modify — register new routers |
| `tests/integration/config-endpoints.test.ts` | Create — 3 config tests |
| `tests/integration/market-leaderboard.test.ts` | Create — leaderboard test |
| `tests/integration/headhunter-candidates-list.test.ts` | Create — GET /v1/headhunter/candidates test |

No business logic files (`src/main/modules/*`) modified.

---

## Existing Code Reference (READ BEFORE STARTING)

The engineer MUST first read these files to understand patterns and find existing functions:

1. `src/main/modules/desensitize/mapping.ts` — find exported `loadIndustryMap()`, `TITLE_LEVEL_PATTERNS`, `SALARY_BANDS`, `SCHOOL_TIERS`
2. `src/main/db/repositories/candidates-anonymized.ts` — find method that lists candidates by headhunter (likely `findByHeadhunterId(headhunterId)` or similar; if name differs, adapt)
3. `src/main/routes/employer.ts` — see pattern for `authMiddleware(db)` + `quota.tryConsume()` + `res.json({ ok: true, data: ... })`
4. `src/main/shared/constants.ts` — find `QUOTA_COSTS` to add new quota costs
5. `src/main/server.ts` — see how routers are registered with `app.use('/v1/employer', ...)`

---

## Task 1: GET /v1/config/industries (TDD)

**Files:**
- Create: `src/main/routes/config.ts`
- Create: `tests/integration/config-endpoints.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/config-endpoints.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/config/*', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  async function registerHeadhunter() {
    const app = createApp();
    const res = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'CfgHH', contact: 'cfg@h.com' });
    return { app, apiKey: res.body.data.api_key };
  }

  describe('GET /v1/config/industries', () => {
    it('returns 200 + array of industries with companies_count', async () => {
      const { app, apiKey } = await registerHeadhunter();
      const res = await request(app).get('/v1/config/industries')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const internet = res.body.data.find((c: any) => c.id === '互联网');
      expect(internet).toBeDefined();
      expect(internet.companies_count).toBeGreaterThan(0);
    });

    it('returns 401 without auth', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/config/industries');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /v1/config/title_levels', () => {
    it('returns 200 + title level patterns', async () => {
      const { app, apiKey } = await registerHeadhunter();
      const res = await request(app).get('/v1/config/title_levels')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const codes = res.body.data.map((t: any) => t.code);
      expect(codes).toContain('P6');
      expect(codes).toContain('P7+');
      expect(codes).toContain('M1');
    });

    it('returns 401 without auth', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/config/title_levels');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /v1/config/salary_bands', () => {
    it('returns 200 + salary bands', async () => {
      const { app, apiKey } = await registerHeadhunter();
      const res = await request(app).get('/v1/config/salary_bands')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      const first = res.body.data[0];
      expect(first.label).toBeDefined();
      expect(typeof first.min).toBe('number');
      expect(first.max === null || typeof first.max === 'number').toBe(true);
    });

    it('returns 401 without auth', async () => {
      const app = createApp();
      const res = await request(app).get('/v1/config/salary_bands');
      expect(res.status).toBe(401);
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/config-endpoints.test.ts 2>&1 | tail -10`
Expected: FAIL — 404 (no router).

- [ ] **Step 3: Add `loadIndustryMap` + constants access from mapping.ts**

Read `src/main/modules/desensitize/mapping.ts`. Find:
- Is `loadIndustryMap()` exported? If not, export it.
- Are `TITLE_LEVEL_PATTERNS` and `SALARY_BANDS` already exported? They should be (per `engine.ts` imports).

If `loadIndustryMap()` is not exported, change:
```typescript
function loadIndustryMap(): ... { ... }
```
to:
```typescript
export function loadIndustryMap(): ... { ... }
```

Also export the type if needed for the response shape.

- [ ] **Step 4: Create `src/main/routes/config.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../modules/auth/middleware.js';
import type { DB } from '../db/connection.js';
import { loadIndustryMap, TITLE_LEVEL_PATTERNS, SALARY_BANDS } from '../modules/desensitize/mapping.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export function createConfigRouter(db: DB): Router {
  const router = Router();
  const quota = createQuotaManager(db);

  router.use(authMiddleware(db));

  router.get('/industries', (req: Request, res: Response) => {
    // Consume 1 quota (optional - config endpoints typically not metered, but skill.md says 配额:1)
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok) {
        if (r.reason === 'INSUFFICIENT_QUOTA') {
          return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
        }
      }
    }
    const { cfg } = loadIndustryMap();
    const data = cfg.categories.map((c: any) => ({
      id: c.id,
      companies_count: (c.companies ?? []).length,
    }));
    res.json({ ok: true, data });
  });

  router.get('/title_levels', (_req: Request, res: Response) => {
    const authedUser = (_req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    const data = TITLE_LEVEL_PATTERNS.map((t: any) => ({
      code: t.level,
      match: t.regex.source,
    }));
    res.json({ ok: true, data });
  });

  router.get('/salary_bands', (_req: Request, res: Response) => {
    const authedUser = (_req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    res.json({ ok: true, data: SALARY_BANDS });
  });

  return router;
}
```

NOTE: The `loadIndustryMap` function returns an object — check its actual shape and adjust. Look at the existing code to see how it's called (e.g., in `engine.ts` or `mapping.ts` itself).

If `QUOTA_COSTS.config_lookup` doesn't exist, add it to `src/shared/constants.ts` as a constant of value `1`. Check the existing pattern first.

- [ ] **Step 5: Register router in `src/main/server.ts`**

Find the section with other routers. Add (near the existing `/v1/employer` etc.):

```typescript
app.use('/v1/config', createConfigRouter(db));
```

- [ ] **Step 6: Run test to verify GREEN**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/config-endpoints.test.ts 2>&1 | tail -10`
Expected: PASS — all 6 tests.

- [ ] **Step 7: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/routes/config.ts src/main/server.ts src/shared/constants.ts src/main/modules/desensitize/mapping.ts tests/integration/config-endpoints.test.ts
git commit -m "feat(config): add GET /v1/config/{industries,title_levels,salary_bands}

Resolves skill.md §3.5 endpoints missing from codebase. Each consumes 1 quota, requires Bearer auth, returns data from existing desensitize mappings."
```

---

## Task 2: GET /v1/market/leaderboard (TDD)

**Files:**
- Create: `src/main/routes/market.ts`
- Create: `tests/integration/market-leaderboard.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/integration/market-leaderboard.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/market/leaderboard', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns 200 with top headhunters sorted by reputation DESC', async () => {
    const app = createApp();
    // Register 3 headhunters with different reputation by direct DB updates
    const hh1 = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'Top HH', contact: 'top@h.com' });
    const hh2 = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'Mid HH', contact: 'mid@h.com' });
    const hh3 = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'Low HH', contact: 'low@h.com' });

    // Use anyone to read leaderboard (auth required, not headhunter-specific)
    const viewer = await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'Viewer', contact: 'viewer@e.com' });

    const res = await request(app).get('/v1/market/leaderboard')
      .set('Authorization', `Bearer ${viewer.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);

    // All start at reputation 50, so order is by creation (insertion order)
    const reputations = res.body.data.map((h: any) => h.reputation);
    expect(reputations.every((r: number) => r === 50)).toBe(true); // default

    // Each entry has rank, id, name, reputation
    expect(res.body.data[0].rank).toBe(1);
    expect(res.body.data[0].id).toMatch(/^user_/);
    expect(typeof res.body.data[0].name).toBe('string');
  });

  it('only includes headhunters (not candidates/employers)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({ user_type: 'candidate', name: 'Cand', contact: 'cand@c.com' });
    await request(app).post('/v1/auth/register').send({ user_type: 'employer', name: 'Emp', contact: 'emp@e.com' });
    const viewer = await request(app).post('/v1/auth/register').send({ user_type: 'headhunter', name: 'HH', contact: 'hh@h.com' });

    const res = await request(app).get('/v1/market/leaderboard')
      .set('Authorization', `Bearer ${viewer.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1); // only the headhunter
    expect(res.body.data[0].name).toBe('HH');
  });

  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/market/leaderboard');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/market-leaderboard.test.ts 2>&1 | tail -10`
Expected: FAIL — 404.

- [ ] **Step 3: Create `src/main/routes/market.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../modules/auth/middleware.js';
import type { DB } from '../db/connection.js';
import { createQuotaManager } from '../modules/quota/manager.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export function createMarketRouter(db: DB): Router {
  const router = Router();
  const quota = createQuotaManager(db);

  router.use(authMiddleware(db));

  // GET /v1/market/leaderboard — top 10 headhunters by reputation DESC
  router.get('/leaderboard', (req: Request, res: Response) => {
    const authedUser = (req as any).user;
    if (authedUser) {
      const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
      if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
        return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
      }
    }
    const rows = db.prepare(
      `SELECT id, name, reputation FROM users
       WHERE user_type = ? AND status = ?
       ORDER BY reputation DESC, created_at ASC
       LIMIT 10`
    ).all('headhunter', 'active');

    const data = rows.map((row: any, idx: number) => ({
      rank: idx + 1,
      id: row.id,
      name: row.name,
      reputation: row.reputation,
    }));
    res.json({ ok: true, data });
  });

  return router;
}
```

- [ ] **Step 4: Register router in `src/main/server.ts`**

```typescript
app.use('/v1/market', createMarketRouter(db));
```

- [ ] **Step 5: Run test to verify GREEN**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/market-leaderboard.test.ts 2>&1 | tail -10`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/routes/market.ts src/main/server.ts tests/integration/market-leaderboard.test.ts
git commit -m "feat(market): add GET /v1/market/leaderboard (top 10 headhunters by reputation)"
```

---

## Task 3: GET /v1/headhunter/candidates (TDD)

**Files:**
- Modify: `src/main/routes/headhunter.ts`
- Create: `tests/integration/headhunter-candidates-list.test.ts`

- [ ] **Step 1: Find the candidates_anonymized repo method**

Read `src/main/db/repositories/candidates-anonymized.ts`. Find the method that lists candidates by `source_headhunter_id`. Likely named `findByHeadhunterId(headhunterId, opts)` or similar. Adapt the test code below if the name differs.

- [ ] **Step 2: Write failing test**

Create `tests/integration/headhunter-candidates-list.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET /v1/headhunter/candidates', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('returns the headhunter\'s uploaded candidates with anonymized_id', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'MyCandHH', contact: 'mycand@h.com' });
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'X', contact: 'x@c.com' });

    await request(app).post('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`)
      .send({
        candidate_user_id: cand.body.data.id,
        name: 'X', phone: '13800138000', email: 'x@x.com',
        current_company: '字节跳动', current_title: 'P6',
        expected_salary: 600000, years_experience: 5,
        education_school: 'S', skills: [],
      });

    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].anonymized_id).toMatch(/^ca_/);
    expect(res.body.data[0].industry).toBe('互联网');
    expect(res.body.data[0].id).toBeUndefined(); // Convention A: only anonymized_id
  });

  it('returns empty array for headhunter with no uploads', async () => {
    const app = createApp();
    const hh = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'EmptyHH', contact: 'empty@h.com' });

    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hh.body.data.api_key}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 403 when called by an employer (not headhunter)', async () => {
    const app = createApp();
    const emp = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'EmpE', contact: 'e@e.com' });
    const res = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${emp.body.data.api_key}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const app = createApp();
    const res = await request(app).get('/v1/headhunter/candidates');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run test to verify RED**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/headhunter-candidates-list.test.ts 2>&1 | tail -10`
Expected: FAIL — 404.

- [ ] **Step 4: Add `GET /candidates` handler in `src/main/routes/headhunter.ts`**

Open `src/main/routes/headhunter.ts`. Find the existing `router.get('/recommendations', ...)` handler. Add ABOVE or BELOW it:

```typescript
  // GET /v1/headhunter/candidates — list this headhunter's uploaded candidates
  router.get('/candidates', (req, res, next) => {
    try {
      const user = (req as typeof req & { user?: User }).user!;
      if (user.user_type !== 'headhunter') throw Errors.forbidden('Only headhunters can list candidates');

      const qResult = quota.tryConsume(user.id, QUOTA_COSTS.list_my_candidates ?? QUOTA_COSTS.config_lookup ?? 1);
      if (!qResult.ok) {
        if (qResult.reason === 'INSUFFICIENT_QUOTA') throw Errors.insufficientQuota();
        if (qResult.reason === 'FORBIDDEN') throw Errors.forbidden('User suspended');
        throw Errors.notFound('User not found');
      }

      // Find candidates uploaded by this headhunter
      const anon = createCandidatesAnonymizedRepo(db);
      const list = anon.findByHeadhunterId(user.id);  // ADAPT method name to actual repo

      // Apply Convention A: remove raw `id`, keep `anonymized_id`
      const data = list.map((c: any) => {
        const { id, skills_json, ...rest } = c;
        return {
          ...rest,
          anonymized_id: id,
          skills: JSON.parse(skills_json ?? '[]'),
        };
      });

      res.json({ ok: true, data });
    } catch (e) { next(e); }
  });
```

NOTES:
- Check actual repo method name. If it's `findByHeadhunterId`, use it. If it's `findBySourceHeadhunter` or similar, adapt.
- Check if `quota` is in scope — if not, add `const quota = createQuotaManager(db);` to the createHeadhunterRouter function.
- Check if `createCandidatesAnonymizedRepo` is imported — add it if not.
- Check if `QUOTA_COSTS.config_lookup` and `QUOTA_COSTS.list_my_candidates` exist; if not, fall back to literal `1` or add to constants.

- [ ] **Step 5: Run test to verify GREEN**

Run: `cd D:\dev\hunter-platform && pnpm test -- tests/integration/headhunter-candidates-list.test.ts 2>&1 | tail -10`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
cd D:\dev\hunter-platform
git add src/main/routes/headhunter.ts tests/integration/headhunter-candidates-list.test.ts
git commit -m "feat(headhunter): add GET /v1/headhunter/candidates (list own uploaded candidates)"
```

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd D:\dev\hunter-platform && pnpm typecheck`
Expected: exit 0, 0 errors.

- [ ] **Step 2: Run full test suite**

Run: `cd D:\dev\hunter-platform && pnpm test 2>&1 | tail -5`
Expected: All tests pass (290+ tests; should be 285 + ~10 new = ~295).

- [ ] **Step 3: Live smoke test**

Start server, register a headhunter, upload a candidate, then curl each endpoint:

```bash
# Kill any existing server
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3

# Start server
cd D:\dev\hunter-platform && pnpm api:dev > tmp/final-smoke.log 2>&1 &

# Wait for server
sleep 5
cat D:/dev/hunter-platform/tmp/final-smoke.log | tail -2
```

Then use `--data-binary @file` (avoids curl shell encoding bug):

```bash
# Register fresh user (avoid rate limit by waiting if needed)
cat > /tmp/reg.json << 'EOF'
{"user_type":"headhunter","name":"FinalHH","contact":"finalhh@h.com"}
EOF
RESP=$(curl -sS -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @/tmp/reg.json)
KEY=$(echo "$RESP" | python -c "import sys, json; print(json.load(sys.stdin)['data']['api_key'])")
echo "KEY=$KEY"

# Test 5 endpoints
for ep in "/v1/config/industries" "/v1/config/title_levels" "/v1/config/salary_bands" "/v1/market/leaderboard" "/v1/headhunter/candidates"; do
  echo -n "GET $ep: "
  curl -sS -o /dev/null -w "%{http_code}\n" "http://localhost:3000$ep" -H "Authorization: Bearer $KEY"
done
```

Expected: All return **200**.

- [ ] **Step 4: Kill server**

```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3
```

- [ ] **Step 5: Push to remote**

```bash
cd D:\dev\hunter-platform
git push origin main
```

- [ ] **Step 6: Report**

Final report:
- (a) git log --oneline -5 showing 3 new commits (config, market, headhunter-candidates)
- (b) full test count
- (c) live smoke test results (5 endpoints all 200)

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|--------------|-----------|
| §2.1 industries endpoint | T1 |
| §2.2 title_levels endpoint | T1 |
| §2.3 salary_bands endpoint | T1 |
| §2.4 leaderboard endpoint | T2 |
| §2.5 headhunter/candidates endpoint | T3 |
| §6 testing strategy | T1, T2, T3, T4 |

**Placeholder scan:** No TBD / TODO / "implement later". T1 Step 4 and T3 Step 4 explicitly say "adapt to actual repo signatures" — intentional, not a placeholder.

**Type consistency:** `User` interface, `createCandidatesAnonymizedRepo`, `quota.tryConsume`, `Errors.forbidden`, `QUOTA_COSTS` — all referenced consistently across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-18-missing-readonly-endpoints.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** - execute tasks in this session with checkpoints for review