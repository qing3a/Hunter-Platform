# Reference Agent — Spec

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session
**前置**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md), [docs/superpowers/skill.md](../skill.md)

---

## 1. 概述

### 1.1 一句话定义

写一个**参考 Agent**（TypeScript 脚本）：调用 `docs/superpowers/skill.md` 列出的**全部 25 个 endpoint**，验证每个都真的存在并按文档行为工作。脚本运行后输出每 endpoint 的 PASS/FAIL 报告。

### 1.2 触发原因

到目前为止，我们靠 supertest integration test 覆盖 backend 行为，但**没人真正按 skill.md 文档从头跑过完整 API**。可能存在：
- skill.md 列了 endpoint，但代码里漏注册 → 测试通过，文档和实现不一致
- skill.md 描述了请求/响应形状，但代码返回字段名不同 → 测试覆盖不到

这个 Agent **就是文档与实现之间的 contract test**。

### 1.3 目标

1. 跑过 skill.md 全部 25 个 endpoint，每个验证状态码 + 关键字段
2. 输出人类可读的报告（PASS/FAIL per endpoint + 总览）
3. 作为**真实用户的参考范例**——给以后想调 API 的人当 template
4. 暴露任何"文档说了但代码没做"或"文档没说但代码有"的偏差

### 1.4 非目标

- 不做性能压测（那是 k6 的活）
- 不做单元测试（vitest 已经做了）
- 不替代 supertest（Agent 跑 HTTP，是端到端）
- 不做 OAuth / API key 长期管理（Agent 是开发工具，每次重新注册）

---

## 2. 端点清单（25 个，全部要跑）

### 2.1 公开（无需 auth）

| # | Method | Path | 来自 skill.md |
|---|--------|------|--------------|
| 1 | GET | `/v1/health` | §3.1 |
| 2 | GET | `/v1/skill.md` | §3.1 |
| 3 | GET | `/v1/openapi.json` | §3.1 |
| 4 | GET | `/metrics` | §9 |

### 2.2 Auth（POST register）

| # | Method | Path | 来自 |
|---|--------|------|------|
| 5 | POST | `/v1/auth/register` | §3 |

### 2.3 Common（每用户）

| # | Method | Path | 来自 |
|---|--------|------|------|
| 6 | GET | `/v1/users/{id}/status` | §3.1 |
| 7 | GET | `/v1/users/{id}/history` | §3.1 |

### 2.4 Employer

| # | Method | Path | 来自 |
|---|--------|------|------|
| 8 | POST | `/v1/employer/jobs` | §3.2 |
| 9 | GET | `/v1/employer/jobs` | §3.2 |
| 10 | GET | `/v1/employer/talent` | §3.2 |
| 11 | POST | `/v1/employer/recommendations/{id}/express-interest` | §3.2 |
| 12 | POST | `/v1/employer/recommendations/{id}/unlock-contact` | §3.2 |
| 13 | POST | `/v1/employer/placements` | §3.2 |
| 14 | GET | `/v1/employer/placements` | §3.2 |

### 2.5 Headhunter

| # | Method | Path | 来自 |
|---|--------|------|------|
| 15 | POST | `/v1/headhunter/candidates` | §3.3 |
| 16 | GET | `/v1/headhunter/candidates` | §3.3 |
| 17 | POST | `/v1/headhunter/candidates/{id}/publish-to-pool` | §3.3 |
| 18 | POST | `/v1/headhunter/recommendations` | §3.3 |
| 19 | GET | `/v1/headhunter/recommendations` | §3.3 |
| 20 | POST | `/v1/headhunter/recommendations/{id}/withdraw` | §3.3 |

### 2.6 Candidate

| # | Method | Path | 来自 |
|---|--------|------|------|
| 21 | GET | `/v1/candidate/opportunities` | §3.4 |
| 22 | GET | `/v1/candidate/access-log` | §3.4 |
| 23 | POST | `/v1/candidate/recommendations/{id}/approve-unlock` | §3.4 |
| 24 | POST | `/v1/candidate/recommendations/{id}/reject-unlock` | §3.4 |

### 2.7 Config / Market（无需 auth）

| # | Method | Path | 来自 |
|---|--------|------|------|
| 25a | GET | `/v1/config/industries` | §3.5 |
| 25b | GET | `/v1/config/title_levels` | §3.5 |
| 25c | GET | `/v1/config/salary_bands` | §3.5 |
| 25d | GET | `/v1/market/leaderboard` | §3.5 |

> §3.4 还列了 `POST /v1/candidate/delete_my_data`（GDPR），可以加但会真删数据 → 加但 rollback。

### 2.8 View token 端点（v2 render layer）

不在 skill.md §3 列表里（skill.md 是 v1 文档），但既然实现存在，应该也跑：

| # | Method | Path |
|---|--------|------|
| 26a | POST | `/v1/views/audit/{user_id}` |
| 26b | POST | `/v1/views/recommendation/{rec_id}` |

加上这 2 个 = **27 个 endpoint**。

---

## 3. 执行场景（按依赖顺序）

不是 25 个独立调用——有些依赖前置状态。组织成 11 个场景：

### Scenario 0: 公开端点（无需 setup）
- 测试 #1, 2, 3, 4, 25a, 25b, 25c, 25d
- 共 8 个

### Scenario 1: 注册 3 个 user
- 测试 #5 × 3（注册 candidate / headhunter / employer）
- 保存 3 个 api_key + id

### Scenario 2: User status & history
- 测试 #6 × 3（每用户）
- 测试 #7 × 3（每用户）

### Scenario 3: Employer 创建 job
- 测试 #8, 9

### Scenario 4: Headhunter 上传 + 发布候选人
- 测试 #15, 17, 16

### Scenario 5: Headhunter 推荐
- 测试 #18, 19

### Scenario 6: Employer 浏览 + 表达兴趣
- 测试 #10, 11

### Scenario 7: Candidate 授权
- 测试 #21, 23

### Scenario 8: Employer 解锁联系方式
- 测试 #12

### Scenario 9: Employer 创建 placement
- 测试 #13, 14

### Scenario 10: Headhunter 撤回推荐
- 测试 #20

### Scenario 11: Candidate 隐私 + reject 路径
- 测试 #22, 24

### Scenario 12: View tokens
- 测试 #26a, 26b

### Scenario 13: GDPR（可选，加但要 rollback 状态）
- POST /v1/candidate/delete_my_data

---

## 4. 文件结构

新建 `examples/reference-agent/`：

```
examples/reference-agent/
├── package.json              # 不需要（用 root 的 tsx）
├── tsconfig.json             # 可选
├── README.md                 # 怎么跑 + 报告怎么看
├── src/
│   ├── client.ts             # HTTP client (fetch wrapper) with base URL + auth
│   ├── reporter.ts           # 报告器：记录 PASS/FAIL per endpoint
│   ├── scenarios/
│   │   ├── 00-public.ts      # 公开端点
│   │   ├── 01-register.ts    # 注册 3 users
│   │   ├── 02-user-status.ts # status + history
│   │   ├── 03-employer-jobs.ts
│   │   ├── 04-headhunter-upload.ts
│   │   ├── 05-headhunter-recommend.ts
│   │   ├── 06-employer-talent.ts
│   │   ├── 07-candidate-approve.ts
│   │   ├── 08-employer-unlock.ts
│   │   ├── 09-employer-placement.ts
│   │   ├── 10-headhunter-withdraw.ts
│   │   ├── 11-candidate-reject.ts
│   │   ├── 12-view-tokens.ts
│   │   └── 13-gdpr.ts
│   └── index.ts              # 主入口：依次跑所有 scenario
└── .gitignore                # 不需要
```

**package.json 不需要**——直接 `npx tsx src/index.ts` 用 root 的 node_modules。

---

## 5. API Client 设计

```typescript
// client.ts
export interface AgentContext {
  baseUrl: string;
  userIds: { candidate?: string; headhunter?: string; employer?: string };
  apiKeys: { candidate?: string; headhunter?: string; employer?: string };
  resources: { anonymized_id?: string; job_id?: string; recommendation_id?: string };
}

export class ApiClient {
  constructor(public ctx: AgentContext) {}

  async request(opts: {
    method: string;
    path: string;
    body?: unknown;
    asUser?: 'candidate' | 'headhunter' | 'employer';
  }): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (opts.asUser) headers.Authorization = `Bearer ${this.ctx.apiKeys[opts.asUser]}`;
    const res = await fetch(`${this.ctx.baseUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data };
  }
}
```

---

## 6. Reporter 设计

```typescript
// reporter.ts
export interface EndpointResult {
  name: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  expected?: number | number[];  // 期望状态码（200, [200, 404] 等）
  error?: string;
  dataShapeCheck?: { path: string; type: string; ok: boolean }[];
}

export class Reporter {
  results: EndpointResult[] = [];

  record(r: EndpointResult) {
    this.results.push(r);
    const tag = r.ok ? '✓' : '✗';
    console.log(`  ${tag} ${r.method.padEnd(6)} ${r.path}  →  ${r.status} ${r.expected ? `(expected ${r.expected})` : ''}`);
    if (r.error) console.log(`    ERROR: ${r.error}`);
  }

  summary() {
    const pass = this.results.filter(r => r.ok).length;
    const fail = this.results.length - pass;
    console.log(`\n=== Summary: ${pass}/${this.results.length} passed, ${fail} failed ===`);
    if (fail > 0) {
      console.log('\nFailures:');
      this.results.filter(r => !r.ok).forEach(r => {
        console.log(`  - ${r.method} ${r.path}: ${r.error || 'status ' + r.status}`);
      });
    }
  }
}
```

---

## 7. Scenario 接口

每个 scenario 文件 export 一个函数：

```typescript
// scenarios/01-register.ts
import { ApiClient } from '../client';
import { Reporter } from '../reporter';

export async function scenario01Register(client: ApiClient, reporter: Reporter) {
  // Register candidate
  const candRes = await client.request({
    method: 'POST', path: '/v1/auth/register',
    body: { user_type: 'candidate', name: 'Agent Test C', contact: `agent-c-${Date.now()}@c.com` },
  });
  reporter.record({
    name: 'register candidate',
    method: 'POST', path: '/v1/auth/register',
    status: candRes.status,
    ok: candRes.status === 200 && !!candRes.data?.data?.id,
    expected: 200,
  });
  client.ctx.userIds.candidate = candRes.data.data.id;
  client.ctx.apiKeys.candidate = candRes.data.data.api_key;

  // ... similar for headhunter + employer
}
```

---

## 8. 主入口

```typescript
// index.ts
import { ApiClient, AgentContext } from './client';
import { Reporter } from './reporter';
import { scenario00Public } from './scenarios/00-public';
import { scenario01Register } from './scenarios/01-register';
// ... etc

async function main() {
  const baseUrl = process.env.HUNTER_BASE_URL ?? 'http://localhost:3000';
  console.log(`🚀 Reference Agent — testing ${baseUrl}\n`);

  const ctx: AgentContext = { baseUrl, userIds: {}, apiKeys: {}, resources: {} };
  const client = new ApiClient(ctx);
  const reporter = new Reporter();

  const scenarios = [
    scenario00Public, scenario01Register, scenario02UserStatus,
    scenario03EmployerJobs, scenario04HeadhunterUpload, scenario05HeadhunterRecommend,
    scenario06EmployerTalent, scenario07CandidateApprove, scenario08EmployerUnlock,
    scenario09EmployerPlacement, scenario10HeadhunterWithdraw, scenario11CandidateReject,
    scenario12ViewTokens, scenario13Gdpr,
  ];

  for (const s of scenarios) {
    try {
      console.log(`\n--- ${s.name} ---`);
      await s(client, reporter);
    } catch (e) {
      console.log(`Scenario ${s.name} crashed: ${(e as Error).message}`);
    }
  }

  reporter.summary();
  process.exit(reporter.results.every(r => r.ok) ? 0 : 1);
}

main();
```

---

## 9. 运行方式

```bash
# Terminal 1: 启 server
cd D:\dev\hunter-platform
pnpm api:dev

# Terminal 2: 跑 Agent
cd D:\dev\hunter-platform
npx tsx examples/reference-agent/src/index.ts

# 输出：
# 🚀 Reference Agent — testing http://localhost:3000
#
# --- Scenario 0: public ---
#   ✓ GET    /v1/health           → 200
#   ✓ GET    /v1/skill.md         → 200
#   ... (8 endpoints)
#
# --- Scenario 1: register ---
#   ✓ POST   /v1/auth/register    → 200 (candidate)
#   ✓ POST   /v1/auth/register    → 200 (headhunter)
#   ... (27 endpoints total)
#
# === Summary: 27/27 passed, 0 failed ===
```

---

## 10. 错误处理

| 场景 | 行为 |
|------|------|
| 单 endpoint 失败 | 记录为 FAIL，继续跑下一个 |
| Scenario 崩溃（throw） | 记录为 CRASHED，继续跑下一个 scenario |
| Server 不可达 | Reporter 立即打印 "Cannot connect to {baseUrl}" 退出 |
| 所有 endpoint 失败 | 退出码 1（非 0）|
| 全部通过 | 退出码 0 |

---

## 11. 测试策略

Agent 本身**没有单元测试**——它本身就是 contract test。但要：
- 测试 `client.ts` 的 request 方法（mock fetch）
- 测试 `reporter.ts` 的 summary 输出
- 用 vitest

或更简单：**Agent 跑过即是测试**。如果有错，看 reporter 输出。

---

## 12. 数据隔离

Agent 用独特 timestamp 后缀 email 避免和现有数据冲突：
```
contact: `agent-c-${Date.now()}@c.com`
```

每次跑都生成新 user，不会复用。

---

## 13. 实现路径（5 tasks）

1. **T1**: 创建目录结构 + `client.ts` + `reporter.ts`
2. **T2**: 写所有 scenario 文件（13 个）
3. **T3**: 写 `index.ts` 主入口
4. **T4**: 写 `README.md` 说明用法
5. **T5**: 实跑验证（启 server + 跑 agent + 修复任何暴露的 bug）

预计 ~800 行代码（client + reporter + 13 scenarios + index + README）。

---

## 14. 决策记录

| 决策 | 选择 | 备选 |
|------|-----|------|
| 端点覆盖 | 全部 27（25 skill.md + 2 view）| 仅 25 skill.md |
| 语言 | TypeScript | Python / Go |
| HTTP 库 | 原生 fetch | axios / undici |
| 运行方式 | CLI 脚本 | vitest 测试 / REPL |
| 数据隔离 | 唯一 timestamp email | 共享 test user |
| 失败行为 | 继续跑下一个 | 中止 |
| 输出 | 控制台 + 退出码 | JSON report |
| 放置位置 | `examples/reference-agent/` | `tools/` 或 `scripts/` |

---

## 15. 未来工作

- Agent 输出加 JSON report 文件（便于 CI）
- Agent 加 `--dry-run` 模式（不真发 POST，只检查 endpoint 存在）
- 把 Agent 加到 CI（每次 PR 跑一遍）
- Agent 加更多 assertions（不只状态码，还检查响应字段）