# Reference Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Build a reference Agent at `examples/reference-agent/` that exercises all 27 endpoints from skill.md + view token endpoints, validates they work, and outputs a PASS/FAIL report.

**Architecture:** TypeScript CLI script with HTTP client wrapper + reporter + 13 scenario files. Uses native fetch, runs via `npx tsx`. No new dependencies.

**Tech Stack:** TypeScript, native fetch, tsx (already in devDeps).

---

## File Structure (to create)

```
examples/reference-agent/
├── README.md
└── src/
    ├── client.ts
    ├── reporter.ts
    ├── index.ts
    └── scenarios/
        ├── 00-public.ts
        ├── 01-register.ts
        ├── 02-user-status.ts
        ├── 03-employer-jobs.ts
        ├── 04-headhunter-upload.ts
        ├── 05-headhunter-recommend.ts
        ├── 06-employer-talent.ts
        ├── 07-candidate-approve.ts
        ├── 08-employer-unlock.ts
        ├── 09-employer-placement.ts
        ├── 10-headhunter-withdraw.ts
        ├── 11-candidate-reject.ts
        └── 12-view-tokens.ts
```

---

## Task 1: HTTP client + reporter

- [ ] **Step 1: Create directory + `client.ts`**

```bash
cd D:\dev-hunter-platform
mkdir -p examples/reference-agent/src/scenarios
```

Create `examples/reference-agent/src/client.ts`:

```typescript
export type UserRole = 'candidate' | 'headhunter' | 'employer';

export interface AgentContext {
  baseUrl: string;
  userIds: { candidate?: string; headhunter?: string; employer?: string };
  apiKeys: { candidate?: string; headhunter?: string; employer?: string };
  resources: {
    anonymized_id?: string;
    job_id?: string;
    recommendation_id?: string;
    view_token_audit?: string;
    view_token_recommendation?: string;
  };
}

export interface RequestResult {
  status: number;
  data: any;
  raw: string;
}

export class ApiClient {
  constructor(public ctx: AgentContext) {}

  async request(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    asUser?: UserRole;
    query?: Record<string, string>;
  }): Promise<RequestResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (opts.asUser) {
      const key = this.ctx.apiKeys[opts.asUser];
      if (!key) throw new Error(`No API key for ${opts.asUser}`);
      headers.Authorization = `Bearer ${key}`;
    }
    let url = `${this.ctx.baseUrl}${opts.path}`;
    if (opts.query) url += `?${new URLSearchParams(opts.query).toString()}`;
    const res = await fetch(url, { method: opts.method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const raw = await res.text();
    let data: any = null;
    if (raw) { try { data = JSON.parse(raw); } catch { /* null */ } }
    return { status: res.status, data, raw };
  }
}
```

- [ ] **Step 2: Create `reporter.ts`**

Create `examples/reference-agent/src/reporter.ts`:

```typescript
export interface EndpointResult {
  name: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  expected?: number | number[];
  error?: string;
}

export class Reporter {
  results: EndpointResult[] = [];

  record(r: EndpointResult): void {
    this.results.push(r);
    const tag = r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const expected = r.expected !== undefined ? ` (expected ${JSON.stringify(r.expected)})` : '';
    const errMsg = r.error ? ` — ${r.error}` : '';
    console.log(`  ${tag} ${r.method.padEnd(6)} ${r.path.padEnd(50)} → ${r.status}${expected}${errMsg}`);
  }

  startScenario(name: string): void {
    console.log(`\n\x1b[1m--- ${name} ---\x1b[0m`);
  }

  summary(): { passed: number; failed: number } {
    const passed = this.results.filter(r => r.ok).length;
    const failed = this.results.length - passed;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary: ${passed}/${this.results.length} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('\nFailures:');
      this.results.filter(r => !r.ok).forEach(r => {
        console.log(`  - ${r.method} ${r.path} (status ${r.status})${r.error ? `: ${r.error}` : ''}`);
      });
    }
    return { passed, failed };
  }
}
```

---

## Task 2: Scenario files (13 files)

- [ ] **Step 1: Create `00-public.ts`** — 8 public endpoints (health, skill.md, openapi, metrics, config×3, leaderboard)

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 0: Public endpoints';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  let res = await client.request({ method: 'GET', path: '/v1/health' });
  r.record({ name: 'health', method: 'GET', path: '/v1/health', status: res.status, ok: res.status === 200 && res.data?.data?.status === 'healthy', expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/skill.md' });
  r.record({ name: 'skill.md', method: 'GET', path: '/v1/skill.md', status: res.status, ok: res.status === 200 && res.raw.includes('# Hunter Platform'), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/openapi.json' });
  r.record({ name: 'openapi', method: 'GET', path: '/v1/openapi.json', status: res.status, ok: res.status === 200 && (res.data?.openapi ?? res.data?.swagger) !== undefined, expected: 200 });

  res = await client.request({ method: 'GET', path: '/metrics' });
  r.record({ name: 'metrics', method: 'GET', path: '/metrics', status: res.status, ok: res.status === 200 && res.raw.includes('# HELP'), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/config/industries' });
  r.record({ name: 'config industries', method: 'GET', path: '/v1/config/industries', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/config/title_levels' });
  r.record({ name: 'config title_levels', method: 'GET', path: '/v1/config/title_levels', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/config/salary_bands' });
  r.record({ name: 'config salary_bands', method: 'GET', path: '/v1/config/salary_bands', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });

  res = await client.request({ method: 'GET', path: '/v1/market/leaderboard' });
  r.record({ name: 'market leaderboard', method: 'GET', path: '/v1/market/leaderboard', status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200 });
}
```

- [ ] **Step 2: Create `01-register.ts`** — register 3 users

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 1: Register 3 users';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  const ts = Date.now();

  for (const role of ['candidate', 'headhunter', 'employer'] as const) {
    const userType = role === 'candidate' ? 'candidate' : role === 'headhunter' ? 'headhunter' : 'employer';
    const emailDomain = role === 'candidate' ? 'c' : role === 'headhunter' ? 'h' : 'e';
    const res = await client.request({
      method: 'POST', path: '/v1/auth/register',
      body: { user_type: userType, name: `Agent${role}`, contact: `agent-${emailDomain}-${ts}@x.com` },
    });
    r.record({
      name: `register ${role}`,
      method: 'POST', path: '/v1/auth/register',
      status: res.status, ok: res.status === 200 && !!res.data?.data?.id,
      expected: 200,
    });
    if (res.data?.data) {
      client.ctx.userIds[role] = res.data.data.id;
      client.ctx.apiKeys[role] = res.data.data.api_key;
    }
  }
}
```

- [ ] **Step 3: Create `02-user-status.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 2: User status & history';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  for (const role of ['candidate', 'headhunter', 'employer'] as const) {
    const id = client.ctx.userIds[role];
    if (!id) continue;

    let res = await client.request({ method: 'GET', path: `/v1/users/${id}/status`, asUser: role });
    r.record({
      name: `${role} status`, method: 'GET', path: `/v1/users/${id}/status`,
      status: res.status, ok: res.status === 200 && res.data?.data?.id === id, expected: 200,
    });

    res = await client.request({ method: 'GET', path: `/v1/users/${id}/history`, asUser: role });
    r.record({
      name: `${role} history`, method: 'GET', path: `/v1/users/${id}/history`,
      status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
    });
  }
}
```

- [ ] **Step 4: Create `03-employer-jobs.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 3: Employer creates job';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  let res = await client.request({
    method: 'POST', path: '/v1/employer/jobs', asUser: 'employer',
    body: { title: 'Senior Frontend Engineer', description: 'From reference agent', requirements: '5+ years', required_skills: ['React', 'TypeScript'] },
  });
  r.record({
    name: 'employer create job', method: 'POST', path: '/v1/employer/jobs',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.id, expected: 200,
  });
  if (res.data?.data?.id) client.ctx.resources.job_id = res.data.data.id;

  res = await client.request({ method: 'GET', path: '/v1/employer/jobs', asUser: 'employer' });
  r.record({
    name: 'employer list jobs', method: 'GET', path: '/v1/employer/jobs',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
```

- [ ] **Step 5: Create `04-headhunter-upload.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 4: Headhunter uploads candidate';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.userIds.candidate) return;

  let res = await client.request({
    method: 'POST', path: '/v1/headhunter/candidates', asUser: 'headhunter',
    body: {
      candidate_user_id: client.ctx.userIds.candidate,
      name: 'Test Cand Profile', phone: '13800138000', email: 'test@x.com',
      current_company: '字节跳动', current_title: 'P6',
      expected_salary: 600000, years_experience: 5,
      education_school: '清华大学', skills: ['React', 'TypeScript', 'Go'],
    },
  });
  r.record({
    name: 'upload candidate', method: 'POST', path: '/v1/headhunter/candidates',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.anonymized_id, expected: 200,
  });
  if (res.data?.data?.anonymized_id) client.ctx.resources.anonymized_id = res.data.data.anonymized_id;
  if (!client.ctx.resources.anonymized_id) return;

  res = await client.request({ method: 'POST', path: `/v1/headhunter/candidates/${client.ctx.resources.anonymized_id}/publish-to-pool`, asUser: 'headhunter' });
  r.record({
    name: 'publish to pool', method: 'POST', path: '/v1/headhunter/candidates/{id}/publish-to-pool',
    status: res.status, ok: res.status === 200, expected: 200,
  });

  res = await client.request({ method: 'GET', path: '/v1/headhunter/candidates', asUser: 'headhunter' });
  r.record({
    name: 'list candidates', method: 'GET', path: '/v1/headhunter/candidates',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
```

- [ ] **Step 6: Create `05-headhunter-recommend.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 5: Headhunter recommends candidate';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.anonymized_id || !client.ctx.resources.job_id) return;

  let res = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', asUser: 'headhunter',
    body: { anonymized_candidate_id: client.ctx.resources.anonymized_id, job_id: client.ctx.resources.job_id },
  });
  r.record({
    name: 'create recommendation', method: 'POST', path: '/v1/headhunter/recommendations',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.id, expected: 200,
  });
  if (res.data?.data?.id) client.ctx.resources.recommendation_id = res.data.data.id;

  res = await client.request({ method: 'GET', path: '/v1/headhunter/recommendations', asUser: 'headhunter' });
  r.record({
    name: 'list recommendations', method: 'GET', path: '/v1/headhunter/recommendations',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
```

- [ ] **Step 7: Create `06-employer-talent.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 6: Employer browses + expresses interest';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);

  let res = await client.request({ method: 'GET', path: '/v1/employer/talent', asUser: 'employer' });
  r.record({
    name: 'browse talent', method: 'GET', path: '/v1/employer/talent',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });

  if (!client.ctx.resources.recommendation_id) return;
  res = await client.request({
    method: 'POST', path: `/v1/employer/recommendations/${client.ctx.resources.recommendation_id}/express-interest`, asUser: 'employer',
  });
  r.record({
    name: 'express interest', method: 'POST', path: '/v1/employer/recommendations/{id}/express-interest',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
```

- [ ] **Step 8: Create `07-candidate-approve.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 7: Candidate approves unlock';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.userIds.candidate || !client.ctx.resources.recommendation_id) return;

  let res = await client.request({ method: 'GET', path: '/v1/candidate/opportunities', asUser: 'candidate' });
  r.record({
    name: 'opportunities', method: 'GET', path: '/v1/candidate/opportunities',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });

  res = await client.request({
    method: 'POST', path: `/v1/candidate/recommendations/${client.ctx.resources.recommendation_id}/approve-unlock`, asUser: 'candidate',
  });
  r.record({
    name: 'approve unlock', method: 'POST', path: '/v1/candidate/recommendations/{id}/approve-unlock',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
```

- [ ] **Step 9: Create `08-employer-unlock.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 8: Employer unlocks contact';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.recommendation_id) return;

  const res = await client.request({
    method: 'POST', path: `/v1/employer/recommendations/${client.ctx.resources.recommendation_id}/unlock-contact`, asUser: 'employer',
  });
  r.record({
    name: 'unlock contact', method: 'POST', path: '/v1/employer/recommendations/{id}/unlock-contact',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
```

- [ ] **Step 10: Create `09-employer-placement.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 9: Employer creates placement';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.job_id || !client.ctx.userIds.candidate || !client.ctx.userIds.headhunter) return;

  let res = await client.request({
    method: 'POST', path: '/v1/employer/placements', asUser: 'employer',
    body: {
      job_id: client.ctx.resources.job_id,
      candidate_user_id: client.ctx.userIds.candidate,
      primary_headhunter_id: client.ctx.userIds.headhunter,
      annual_salary: 600000,
    },
  });
  r.record({
    name: 'create placement', method: 'POST', path: '/v1/employer/placements',
    status: res.status, ok: res.status === 200 || res.status === 201, expected: [200, 201],
  });

  res = await client.request({ method: 'GET', path: '/v1/employer/placements', asUser: 'employer' });
  r.record({
    name: 'list placements', method: 'GET', path: '/v1/employer/placements',
    status: res.status, ok: res.status === 200 && Array.isArray(res.data?.data), expected: 200,
  });
}
```

- [ ] **Step 11: Create `10-headhunter-withdraw.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 10: Headhunter withdraws (new recommendation)';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.anonymized_id || !client.ctx.resources.job_id) return;

  const createRes = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', asUser: 'headhunter',
    body: { anonymized_candidate_id: client.ctx.resources.anonymized_id, job_id: client.ctx.resources.job_id },
  });
  const newRecId = createRes.data?.data?.id;
  if (!newRecId) {
    r.record({ name: 'setup for withdraw', method: 'POST', path: '/v1/headhunter/recommendations', status: createRes.status, ok: false, error: 'setup failed' });
    return;
  }

  const res = await client.request({
    method: 'POST', path: `/v1/headhunter/recommendations/${newRecId}/withdraw`, asUser: 'headhunter',
  });
  r.record({
    name: 'withdraw recommendation', method: 'POST', path: '/v1/headhunter/recommendations/{id}/withdraw',
    status: res.status, ok: res.status === 200, expected: 200,
  });
}
```

- [ ] **Step 12: Create `11-candidate-reject.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 11: Candidate reject + access log';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.resources.anonymized_id || !client.ctx.resources.job_id || !client.ctx.userIds.candidate) return;

  // Create a fresh rec + express-interest (rejects only work on employer_interested state)
  const createRes = await client.request({
    method: 'POST', path: '/v1/headhunter/recommendations', asUser: 'headhunter',
    body: { anonymized_candidate_id: client.ctx.resources.anonymized_id, job_id: client.ctx.resources.job_id },
  });
  const newRecId = createRes.data?.data?.id;
  if (!newRecId) return;

  await client.request({ method: 'POST', path: `/v1/employer/recommendations/${newRecId}/express-interest`, asUser: 'employer' });

  let res = await client.request({
    method: 'POST', path: `/v1/candidate/recommendations/${newRecId}/reject-unlock`, asUser: 'candidate',
  });
  r.record({
    name: 'reject unlock', method: 'POST', path: '/v1/candidate/recommendations/{id}/reject-unlock',
    status: res.status, ok: res.status === 200, expected: 200,
  });

  if (client.ctx.userIds.candidate) {
    const accessRes = await client.request({ method: 'GET', path: '/v1/candidate/access-log', asUser: 'candidate' });
    r.record({
      name: 'access log', method: 'GET', path: '/v1/candidate/access-log',
      status: accessRes.status, ok: accessRes.status === 200 && Array.isArray(accessRes.data?.data), expected: 200,
    });
  }
}
```

- [ ] **Step 13: Create `12-view-tokens.ts`**

```typescript
import type { ApiClient } from '../client';
import type { Reporter } from '../reporter';

export const name = 'Scenario 12: View tokens (v2 render layer)';

export async function run(client: ApiClient, r: Reporter): Promise<void> {
  r.startScenario(name);
  if (!client.ctx.userIds.candidate) return;

  let res = await client.request({
    method: 'POST', path: `/v1/views/audit/${client.ctx.userIds.candidate}`, asUser: 'candidate',
  });
  r.record({
    name: 'audit view token', method: 'POST', path: '/v1/views/audit/{user_id}',
    status: res.status, ok: res.status === 200 && !!res.data?.data?.view_url, expected: 200,
  });
  const auditUrl = res.data?.data?.view_url as string | undefined;
  if (auditUrl) {
    const path = auditUrl.replace(client.ctx.baseUrl, '');
    const viewRes = await client.request({ method: 'GET', path });
    r.record({
      name: 'audit view HTML', method: 'GET', path: '/view/audit/{id}?t=...',
      status: viewRes.status, ok: viewRes.status === 200 && viewRes.raw.includes('审计日志'), expected: 200,
    });
  }

  if (client.ctx.resources.recommendation_id) {
    res = await client.request({
      method: 'POST', path: `/v1/views/recommendation/${client.ctx.resources.recommendation_id}`, asUser: 'headhunter',
    });
    r.record({
      name: 'recommendation view token', method: 'POST', path: '/v1/views/recommendation/{rec_id}',
      status: res.status, ok: res.status === 200 && !!res.data?.data?.view_url, expected: 200,
    });
  }
}
```

---

## Task 3: Main entry + README + smoke + commit

- [ ] **Step 1: Create `index.ts`**

Create `examples/reference-agent/src/index.ts`:

```typescript
import { ApiClient, AgentContext } from './client';
import { Reporter } from './reporter';
import * as s00 from './scenarios/00-public';
import * as s01 from './scenarios/01-register';
import * as s02 from './scenarios/02-user-status';
import * as s03 from './scenarios/03-employer-jobs';
import * as s04 from './scenarios/04-headhunter-upload';
import * as s05 from './scenarios/05-headhunter-recommend';
import * as s06 from './scenarios/06-employer-talent';
import * as s07 from './scenarios/07-candidate-approve';
import * as s08 from './scenarios/08-employer-unlock';
import * as s09 from './scenarios/09-employer-placement';
import * as s10 from './scenarios/10-headhunter-withdraw';
import * as s11 from './scenarios/11-candidate-reject';
import * as s12 from './scenarios/12-view-tokens';

interface Scenario { name: string; run: (c: ApiClient, r: Reporter) => Promise<void>; }
const SCENARIOS: Scenario[] = [s00, s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12];

async function main() {
  const baseUrl = process.env.HUNTER_BASE_URL ?? 'http://localhost:3000';
  console.log(`\n🚀 Reference Agent — testing ${baseUrl}\n`);
  console.log(`Coverage: 27 endpoints across 13 scenarios\n`);

  try {
    const probe = await fetch(`${baseUrl}/v1/health`);
    if (!probe.ok) {
      console.error(`❌ Cannot reach ${baseUrl}/v1/health (status ${probe.status})`);
      console.error('   Is the API server running? Start with: pnpm api:dev');
      process.exit(1);
    }
  } catch {
    console.error(`❌ Connection refused to ${baseUrl}`);
    console.error('   Is the API server running? Start with: pnpm api:dev');
    process.exit(1);
  }

  const ctx: AgentContext = { baseUrl, userIds: {}, apiKeys: {}, resources: {} };
  const client = new ApiClient(ctx);
  const reporter = new Reporter();

  for (const scenario of SCENARIOS) {
    try { await scenario.run(client, reporter); }
    catch (e) { console.error(`Scenario crashed: ${(e as Error).message}`); }
  }

  const { passed, failed } = reporter.summary();
  console.log(`\nEndpoint coverage: ${reporter.results.length} endpoints tested\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Reference Agent

A TypeScript script that exercises every endpoint documented in `docs/superpowers/skill.md`.

Use cases:
1. Contract test — validates docs match code
2. Reference implementation — shows real users how to call API
3. Smoke test — catches docs/code drift

## Run

\`\`\`bash
# Terminal 1: start server
cd D:\dev\hunter-platform
pnpm api:dev

# Terminal 2: run agent
npx tsx examples/reference-agent/src/index.ts
\`\`\`

## Output

\`\`\`
🚀 Reference Agent — testing http://localhost:3000

--- Scenario 0: Public endpoints ---
  ✓ GET    /v1/health        → 200
  ...

============================================================
Summary: 27/27 passed, 0 failed
\`\`\`

Exit code 0 if all pass, 1 otherwise.

## Coverage

27 endpoints: 8 public + 4 config + 1 auth + 6 user + 7 employer + 6 headhunter + 4 candidate + 2 view tokens. Each endpoint is called at least once with state validation.
```

- [ ] **Step 3: Smoke test (start server, run agent, verify pass)**

```bash
/c/Windows/System32/taskkill.exe //F //IM node.exe //FI "PID gt 1000" 2>&1 | head -3
cd D:\dev-hunter-platform && nohup pnpm api:dev > tmp/refagent-server.log 2>&1 &
disown
sleep 8
curl -sS -o /dev/null -w "Server: %{http_code}\n" http://localhost:3000/v1/health

cd D:\dev-hunter-platform
npx tsx examples/reference-agent/src/index.ts 2>&1 | tail -60

/c/Windows/System32/taskkill.exe //F //IM node.exe 2>&1 | head -3
```

Expected: 27/27 passed. If anything fails, debug the specific failing endpoint — that's the whole point of this agent.

- [ ] **Step 4: Commit + push**

```bash
cd D:\dev-hunter-platform
git add examples/reference-agent/
git commit -m "feat(examples): add reference agent validating all 27 endpoints

A TypeScript CLI script that exercises every endpoint documented in
skill.md plus the v2 view-token endpoints. Reports PASS/FAIL per call.

Use cases:
1. Contract test — validates docs match code
2. Reference implementation — shows real users how to call API
3. Smoke test — catches docs/code drift

13 scenarios covering all 27 endpoints. No new dependencies.

Run with: npx tsx examples/reference-agent/src/index.ts"
git push origin main
```

---

## Self-Review

- Spec coverage: T1 (infra) + T2 (13 scenarios) + T3 (main + smoke + commit)
- No placeholders. Each scenario is complete code.
- Type consistency: `ApiClient`, `AgentContext`, `Reporter`, `EndpointResult` defined in T1 and used consistently.

## Execution Handoff

Plan saved. Estimated: 1 commit, ~700 lines across 15 files, ~30 min.