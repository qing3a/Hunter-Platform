# Hunter Platform 修复执行计划 v1.3：skill.md 打磨 + market jobs 端点

> **任务**：13 项文档修复 + 1 项代码新增（`/v1/market/jobs` 公共端点）
>
> **背景**：v1.1/v1.2 修复后，skill.md 仍有一些 doc/code 不一致 + 缺失。本次集中打磨。
>
> **依据**：`D:\Users\Administrator\Desktop\hunter-skill-design.md` 的审计 + 独立验证

---

## 上下文

- 服务跑在 `http://localhost:3000`，源码 `D:\dev\hunter-platform`
- 当前 skill.md：855 行（v1.2 后）；CHANGELOG.md：v0.3.0/v0.3.1/v1.1/v1.2 共 4 节
- 当前端点：~29 个；talent 7 个 query 参数（v1.2 加）
- 当前测试：381/381 PASS
- jobs 表 schema 已有 `industry`、`salary_min`、`salary_max`、`status` 字段
- **关键发现**：`src/main/db/repositories/jobs.ts` 已经有 `listPublic(opts)` 方法（仅支持 industry + limit/offset）—— 这次只需补 route + 测试 + 文档

---

## 涉及文件

| 文件 | 改/建 | 用途 |
|---|---|---|
| `src/main/routes/market.ts` | **改** | 加 `GET /v1/market/jobs` route |
| `src/shared/constants.ts` | **改** | 加 `browse_jobs: 1` 到 `QUOTA_COSTS` |
| `tests/integration/market-jobs.test.ts` | **新建** | 6 个集成测试 |
| `docs/superpowers/skill.md` | **改** | 13 项文档修复 + 加 §2.5 market jobs 说明 + §11.3 重写 |
| `docs/CHANGELOG.md` | **改** | 加 v1.3 节 |

**5 个文件**：2 源码 + 1 新测试 + 2 文档。

---

## 关键事实（已核实，避免抄错）

| 事实 | 来源 |
|---|---|
| `jobs` 表字段：`title, description, salary_min, salary_max, industry, status, priority, deadline, created_at` | `v002.sql` |
| `listPublic({industry, limit, offset})` 已存在 | `src/main/db/repositories/jobs.ts:67-83` |
| `listPublic` 只支持 industry 过滤 + limit/offset | 同上（**不支持** skills/salary 过滤） |
| `/v1/market/leaderboard` 用 `optionalAuthMiddleware`（§5.6 unlimited） | `src/main/routes/market.ts:10` |
| 配额成本常量在 `QUOTA_COSTS` | `src/shared/constants.ts:20-38` |
| hunter-platform 已有 `Job` 类型定义 | `src/shared/types.ts` |

**不要做的扩展**（plan 范围内不实现）：
- ❌ 不加 `title_contains`/`skills`/`min_salary` 过滤（listPublic 不支持；要扩展需改 repo + SQL，单独 task）
- ❌ 不加新 migration（schema 不变）
- ❌ 不修改 listPublic 方法
- ❌ 不引入新的 auth 中间件

---

# T1：代码改动

## T1.1：加 `browse_jobs` 到 `QUOTA_COSTS`

**文件**：`src/shared/constants.ts`

**改动**（line 20-38 附近）：

```typescript
export const QUOTA_COSTS = {
  register: 0,
  upload_candidate: 5,
  // M2:
  create_job: 5,
  browse_talent: 1,
  browse_jobs: 1,  // ← 新增（v1.3）
  express_interest: 3,
  unlock_contact: 5,
  recommend_candidate: 5,
  withdraw_recommendation: 1,
  publish_to_pool: 2,
  view_opportunities: 1,
  approve_unlock: 3,
  reject_unlock: 1,
  list_recommendations: 1,
  list_my_jobs: 1,
  config_lookup: 1,
  list_my_candidates: 1,
} as const;
```

**验证**：`as const` 保留以维持类型推断。

---

## T1.2：加 `GET /v1/market/jobs` route

**文件**：`src/main/routes/market.ts`

**改动**：在 `createMarketRouter` 内部，`/leaderboard` route 之后加新 route：

```typescript
// GET /v1/market/jobs — public job marketplace (v1.3)
// skill.md §5.6: /v1/market/* is "unlimited, no auth" — optional auth only.
router.get('/jobs', (req: Request, res: Response) => {
  const authedUser = (req as any).user;
  if (authedUser) {
    const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.browse_jobs);
    if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
      return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
    }
  }
  // Query params (optional, 组合 AND)
  const industry = typeof req.query.industry === 'string' ? req.query.industry : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  // 使用已存在的 listPublic (src/main/db/repositories/jobs.ts:67)
  const { createJobsRepo } = await import('../db/repositories/jobs.js');
  const jobs = createJobsRepo(db).listPublic({ industry, limit, offset });

  res.json({ ok: true, data: jobs });
});
```

**注意**：
- `await import(...)` 因为是 ESM 顶层 + 动态 import；或者在文件顶部 import 即可
- 用 `listPublic` 已支持 industry 过滤 + limit/offset
- 不返回 `employer_id` 等敏感字段（保持 marketplace 简洁）—— **实际决定**：保留 employer_id 因为对候选人联系雇主需要。检查 `listPublic` 返回的字段，让 `Job` 类型的字段自然出来即可
- optional auth：有 auth 扣 quota，无 auth 跳过

**更简单的实现**（避免 dynamic import）：

在文件顶部加 import：
```typescript
import { createJobsRepo } from '../db/repositories/jobs.js';
```

然后 route 内部用：
```typescript
const jobs = createJobsRepo(db).listPublic({ industry, limit, offset });
```

---

## T1.3：新建集成测试

**文件**：`tests/integration/market-jobs.test.ts`（**新建**）

**测试用例**（6 个）：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/market-jobs.db');
let app: any;

describe('GET /v1/market/jobs', () => {
  let empAKey: string;
  let empBKey: string;
  let huntKey: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // 注册 2 个 employer + 1 个 headhunter
    const empA = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'A公司', contact: 'empa@x.com' });
    empAKey = empA.body.data.api_key;
    const empB = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'B公司', contact: 'empb@x.com' });
    empBKey = empB.body.data.api_key;
    const hunt = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: '测试猎头', contact: 'hunt@x.com' });
    huntKey = hunt.body.data.api_key;

    // 创建 4 个 JD：A公司 2 个 + B公司 2 个
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empAKey}`)
      .send({ title: '前端工程师-A1', industry: '互联网', salary_min: 500000, salary_max: 800000 });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empAKey}`)
      .send({ title: '后端工程师-A2', industry: '互联网', salary_min: 600000, salary_max: 1000000 });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empBKey}`)
      .send({ title: '产品经理-B1', industry: '金融', salary_min: 800000, salary_max: 1500000 });
    await request(app).post('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empBKey}`)
      .send({ title: '设计师-B2', industry: '金融', salary_min: 400000, salary_max: 700000 });

    // 关闭 1 个 JD（测试不返回 closed 状态）
    const allJobs = await request(app).get('/v1/employer/jobs')
      .set('Authorization', `Bearer ${empAKey}`);
    const jobToClose = allJobs.body.data[0];
    // v1 没有 close-job API，状态默认 'open'，所以这个测试要跳过或调整
  });

  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('MJ-1: 无 auth 返回所有 open jobs（4 个）', async () => {
    const r = await request(app).get('/v1/market/jobs');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(4);
  });

  it('MJ-2: ?industry=互联网 过滤到 2 个', async () => {
    const r = await request(app).get('/v1/market/jobs?industry=互联网');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
    for (const j of r.body.data) {
      expect(j.industry).toBe('互联网');
    }
  });

  it('MJ-3: ?limit=2 限制返回 2 个', async () => {
    const r = await request(app).get('/v1/market/jobs?limit=2');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
  });

  it('MJ-4: ?offset=2 跳过 2 个', async () => {
    const r = await request(app).get('/v1/market/jobs?offset=2&limit=2');
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(2);
  });

  it('MJ-5: headhunter 有 auth 时返 200 + 扣 quota', async () => {
    const r = await request(app).get('/v1/market/jobs')
      .set('Authorization', `Bearer ${huntKey}`);
    expect(r.status).toBe(200);
    // 不能直接验证 quota 扣减（需查 DB），仅验证 status
  });

  it('MJ-6: 字段包含 title/salary/industry', async () => {
    const r = await request(app).get('/v1/market/jobs?limit=1');
    expect(r.status).toBe(200);
    const j = r.body.data[0];
    expect(j).toHaveProperty('title');
    expect(j).toHaveProperty('industry');
    expect(j).toHaveProperty('salary_min');
    expect(j).toHaveProperty('salary_max');
  });
});
```

**注意**：
- v1 没有 close-job API，所有 job 默认 'open' 状态；测 5（带 auth）只验 status 不验 quota
- 测试用 `superagent` 默认是中文 OK 的，不需要 URL 编码
- 4 个 JD 创建后 listPublic 应返 4 个；用 industry 过滤应剩 2 个

---

# T2：文档改动（13 项）

## D1：§6.1 修 webhook 事件名

**文件**：`docs/superpowers/skill.md` §6.1 表格

**改动**：
```diff
 | `notify_unlock_request` | 雇主表达兴趣 | candidate agent |
-| `unlock_approved_by_candidate` | 候选人授权 | employer agent |
+| `notify_unlock_approved` | 候选人授权 | employer agent |
 | `deliver_contact` | 解锁成功（payload **含 PII**） | employer agent |
 | `placement_created` | 入职记录创建 | headhunter agent |
 | `quota_warning` | 配额用至 80% | 该 user agent |
```

---

## D2：§2.2 补 talent 7 个 query 参数

**文件**：`docs/superpowers/skill.md` §2.2 雇主表

**改动**：在 `GET /v1/employer/talent` 行后**追加一个** sub-table：

```markdown
**`GET /v1/employer/talent` query 参数**（v1.2 起共 7 个，全部可选，AND 组合）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `industry` | string | 完全匹配 `candidates_anonymized.industry`（如 `互联网`） |
| `title_level` | string | 完全匹配 `title_level`（如 `P6`、`P7+`） |
| `min_years` | integer | `years_experience ≥ N` |
| `max_years` | integer | `years_experience ≤ N` |
| `skills` | csv | 逗号分隔，任一命中即可（OR 逻辑） |
| `min_salary` | integer | 年薪下限（含），与 `SALARY_BANDS` 求交集（v1.2 新增） |
| `max_salary` | integer | 年薪上限（含），与 `SALARY_BANDS` 求交集（v1.2 新增） |

> ⚠️ `min_salary=invalid`（NaN）被忽略，返回所有；`min > max` 返回空数组。
```

---

## D3：§2.3 补 `referrer_headhunter_id`

**文件**：`docs/superpowers/skill.md` §2.3 猎头表

**改动**：在 `POST /v1/headhunter/recommendations` 行后**追加**：

```markdown
**`POST /v1/headhunter/recommendations` 请求体**：
```json
{
  "anonymized_candidate_id": "ca_xxx",
  "job_id": "job_xxx",
  "referrer_headhunter_id": "user_yyy",   // 可选：跨猎头协作
  "commission_split": {"hunter": 0.8, "referrer": 0.2}  // 可选，默认 100:0
}
```

> **跨猎头协作**：传 `referrer_headhunter_id` 后，placement 自动按 `commission_split` 分账。
> ⚠️ placement body **不传** `commission_split_json`（schema 验证 400）。
```

---

## D4：§C 改写 OpenAPI 引用

**文件**：`docs/superpowers/skill.md` 附录 C

**改动**：
```diff
-## 📚 附录 C. 端点 → OpenAPI 对照
-
-完整的 OpenAPI 3 spec 见 [`/v1/openapi.json`](https://api.hunter-platform.com/v1/openapi.json)。  
-所有 §2 列举的端点都在 OpenAPI 中，schema 校验规则以 OpenAPI 为准。
+## 📚 附录 C. 端点 → OpenAPI 对照
+
+OpenAPI 3 spec 见 [`/v1/openapi.json`](http://localhost:3000/v1/openapi.json)。
+
+⚠️ **OpenAPI 覆盖范围**（v1.3 时点）：
+- ✅ 已声明的端点：18 条（核心业务 + 公共 endpoint）
+- ⚠️ **未声明的端点**：`/v1/auth/rotate-key`、`/v1/candidate/delete-my-data`、
+  `/v1/users/{id}/history`、`/v1/market/jobs` 等 11+ 条
+- → **以 skill.md §2 主文为准**，OpenAPI 仅作 schema 参考
+
+Agent 集成时，先看 §2 endpoint 表 + query 参数，再核对 OpenAPI 是否覆盖。
```

---

## D5：§E 区分 view_url 失效条件

**文件**：`docs/superpowers/skill.md` 附录 E 调试清单

**改动**：在 `view_url 410 Gone` 行**追加**：

```diff
 | view_url 410 Gone | token 单次使用，重新走流程生成新 token |
+| view_url 410 Gone（24h 后）| token 过期，重新走完整流程 |
+| view_url 401 Unauthorized | agent_endpoint 已撤销，重新注册或联系 owner |
```

**新增段落**（附录 E 末尾）：

```markdown
### view_url 失效条件（两种独立）

| 触发条件 | 状态码 | 含义 |
|----------|--------|------|
| 同一 token 第二次访问 | 410 Gone | **单次使用**——已消费 |
| 同一 token 24h 后访问 | 410 Gone | **JWT 过期** |

两者都返 410，agent 需重新走 unlock 流程生成新 token。
```

---

## D6：§A 删除 v2 路线图（移至 §B）

**文件**：`docs/superpowers/skill.md` 附录 A

**改动**：删除"⏳ v2 路线图：加密密钥轮换、多语言、完整 GDPR 导出、推荐评分模型"行（v1.1 + v1.2 已实现部分，已在 §B changelog 记录）。

```diff
 ## 📚 附录 A. v1 范围
 
 - ✅ 注册/认证/三角色基础
 - ...
--⏳ v2 路线图：加密密钥轮换、多语言、完整 GDPR 导出、推荐评分模型。
+-（v1.1+ 进展见 §B changelog；v2 待规划）
```

---

## D7：§3.1 状态矩阵补 `rejected_employer` 行

**文件**：`docs/superpowers/skill.md` §3.1

**改动**：在状态转换矩阵添加 2 行：

```markdown
 | candidate_approved | → unlocked | rejected_candidate |
 | employer_interested  | rejected_employer | rejected_employer（终态）|
 | pending              | rejected_employer | rejected_employer（终态）|
```

---

## D8：§5.1 加概念区分

**文件**：`docs/superpowers/skill.md` §5.1

**改动**：在 §5.1 表格前加一段：

```markdown
> 💡 **概念区分**：
> - **配额（quota）**：每日总成本，0 点 UTC 重置。超了返 429 `INSUFFICIENT_QUOTA`。
> - **限流（rate limit）**：突发流量控制（1s/1m/1h 桶），撞限返 429 `RATE_LIMITED`，带 `Retry-After` header。
> - 两者独立。配额管"今天能烧多少"，限流管"短时打多快会被限"。
```

---

## D9：§B 版本号排序

**文件**：`docs/CHANGELOG.md`

**改动**：把现有 4 节（v0.3.0 / v0.3.1 / v1.1 / v1.2）**重排倒序**，v1.3 在最上：

```diff
+# v1.3 — 2026-06-19
+...
+
 ## v1.2 — 2026-06-19
 ...
-
-## v0.3.1 — 2026-06-19
-...
```

**v1.3 内容**：
```markdown
## v1.3 — 2026-06-19

### ✨ 新增功能

| 端点变化 | 说明 |
|------|------|
| `GET /v1/market/jobs` 新增公共端点 | 猎头无需注册雇主身份即可看市场所有 open JD；可选 `industry` / `limit` / `offset` query 参数；optional auth 时扣 1 quota |

### 📖 文档

- 13 项 polish（见 §6.1 / §2.2 / §2.3 / §C / §E / §A / §3.1 / §5.1）
- 区分 view_url 24h 过期 vs 单次使用

### ✅ 验证

- 新增 6 个 market jobs 集成测试
- `pnpm test` 期望：≥ 387 / 387 PASS
```

---

## D10：§11.3 修跨雇主 JD 可见性

**文件**：`docs/superpowers/skill.md` §11.3 猎头推荐

**改动**：在 §11.3 "3. 猎头推荐" 步骤**前**加：

```markdown
> 💡 **新流程（v1.3 起）**：猎头想看市场所有 open JD，用：
> ```python
> jobs = get('/v1/market/jobs?industry=互联网')['data']  # 公共端点，无需雇主身份
> ```
> 不再需要"猎头先注册雇主身份"或"让雇主主动 push"。
```

**原步骤 3** 不变（仍演示推荐一个具体 job）。

---

## D11：§1.1 末 changelog 移到 §B

**文件**：`docs/superpowers/skill.md` §1.1

**改动**：删除"历史变更：响应从 `data.user_id` 改为 `data.id`（v1 breaking change）..."行。

**§B** 已记录此条（v1.1 changelog 中）。

---

## D12：§4.3 / §6.2 措辞简化

**文件**：`docs/superpowers/skill.md`

**改动 1**（§4.3）：
```diff
 服务端严格验证请求体**原始字节**（之前仅看 Content-Type header）：遇到 GBK/GB18030 → 400 `INVALID_CHARSET`
+（v1.1 起）服务端严格验证请求体**原始字节**（之前仅看 Content-Type header）：遇到 GBK/GB18030 → 400 `INVALID_CHARSET`。
+合法 UTF-8 字节（包括 emoji、组合字符）均通过；只有非 UTF-8 字节序列被拒。
```

**改动 2**（§6.2）：
```diff
-用 `crypto.timingSafeEqual` 恒定时间比较 —— 防时序攻击
+接收方应做**常量时间比较**（任何语言 SDK 都有相应 API）—— 防时序攻击
```

---

## D13：§5.4 RateLimit-Limit 注释

**文件**：`docs/superpowers/skill.md` §5.4

**改动**：在表头加注释：

```diff
 三个窗口的上限（1s/60s/3600s 顺序）
+按**当前 user_type** 取值（candidate/headhunter/employer 对应不同行），agent 解析时需对应角色。
```

---

# T3：验证

完成后跑：

```bash
cd d:/dev/hunter-platform

# 1. 类型检查
pnpm typecheck
# 期望 0 errors

# 2. 单元 + 集成测试
pnpm test
# 期望：
#   Test Files: 90 passed (89 + 1 新增 market-jobs.test.ts)
#   Tests:      ≥ 387 passed (381 + 6 新增)

# 3. 手动 smoke test（验证 market jobs 端点）
python3 << 'PYEOF'
import urllib.request, json

def api(m, p, b=None, t=None):
    h = {'Content-Type':'application/json; charset=utf-8'}
    if t: h['Authorization']=f'Bearer {t}'
    d = json.dumps(b, ensure_ascii=False).encode('utf-8') if b else None
    r = urllib.request.Request(f'http://localhost:3000{p}', data=d, headers=h, method=m)
    try:
        with urllib.request.urlopen(r) as resp: return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read().decode('utf-8'))

# 注册两个 employer，创建 JD
_, ea = api('POST', '/v1/auth/register', {'user_type':'employer','name':'E1','contact':'e1@x.com'})
_, eb = api('POST', '/v1/auth/register', {'user_type':'employer','name':'E2','contact':'e2@x.com'})
api('POST', '/v1/employer/jobs', {'title':'Job1','industry':'互联网'}, t=ea['data']['api_key'])
api('POST', '/v1/employer/jobs', {'title':'Job2','industry':'金融'}, t=eb['data']['api_key'])

# 无 auth 看 market jobs
s, d = api('GET', '/v1/market/jobs')
print(f'无 auth: {len(d["data"])} 个')
print(f'  示例: {d["data"][0]["title"]} / {d["data"][0]["industry"]}')

# 过滤 industry=互联网
s, d = api('GET', '/v1/market/jobs?industry=互联网')
print(f'industry=互联网: {len(d["data"])} 个')
PYEOF
```

---

# 🚫 不要做的事

- ❌ 不要修改 `listPublic` 方法（已在 repo 里支持 industry + limit/offset）
- ❌ 不要新增 DB migration（schema 不变）
- ❌ 不要碰其他 route 或 handler
- ❌ 不要触碰 v1.1/v1.2 修复（v008 migration、AUDITED_PREFIXES、talent salary filter）
- ❌ 不要修改现有任何测试用例
- ❌ 不要新增 §14（独立的策略层，那是另一个 task）
- ❌ 不要把 `/v1/market/jobs` 加 auth 限制（§5.6 unlimited）
- ❌ 不要给 market jobs 端点扩展 `skills`/`min_salary` 过滤（listPublic 不支持；单独 task）

---

# 硬约束

- ✅ 只改这 5 个文件：
    src/main/routes/market.ts
    src/shared/constants.ts
    tests/integration/market-jobs.test.ts  (新建)
    docs/superpowers/skill.md
    docs/CHANGELOG.md
- ✅ 测试 6 个集成用例覆盖核心路径
- ✅ 不改 schema、不改 listPublic

---

# 关键陷阱（来自历史经验）

1. **ESM import 必须带 `.js` 后缀**：
   `import { createJobsRepo } from '../db/repositories/jobs.js';`
   不是 `'../db/repositories/jobs'`（编译错）

2. **/v1/market/* 不需要 auth**（§5.6 unlimited）：
   用 `optionalAuthMiddleware` 而非 `authMiddleware`

3. **listPublic 字段集合**（不要乱加）：
   Job type 字段：`id, employer_id, title, description, requirements(?), salary_min, salary_max, status, priority, deadline, industry, created_at, updated_at`
   response 自然输出这些字段，不要手动 map

4. **测试中文 name**：
   superagent 默认 UTF-8 没问题。但 URL 中中文 query 参数（虽然 market jobs 不需要中文 filter）要 URL-encode

5. **plan 之外的"改进"**：
   即使想加 skills 过滤、min_salary 过滤，忍住——这是另一个 task

---

# 卡住时怎么办

- `pnpm typecheck` 报缺 import → 检查 .js 后缀
- 测试 `404` → 检查 route mount 顺序
- 测试 `500` → 看 server stderr
- 不想做某项 → 提前报告，不要跳过

---

# 验收清单

完成后报告：

1. **修改文件清单**（应有 5 个）：
   - src/main/routes/market.ts
   - src/shared/constants.ts
   - tests/integration/market-jobs.test.ts（新建）
   - docs/superpowers/skill.md
   - docs/CHANGELOG.md

2. **验证输出**：
   - `pnpm typecheck`（0 errors）
   - `pnpm test` 最后 5 行（≥ 387 passed）

3. **smoke test 输出**：
   - market jobs 端点的实际响应

4. **如发现 plan 之外的问题**（例如 listPublic 字段不够），**报告不修**

---

# 工作时间估计

- T1（代码 1+2）：10 分钟
- T1.3（测试）：20 分钟
- T2（13 项文档）：30 分钟
- T3（验证）：5 分钟

**总计：~65 分钟**
