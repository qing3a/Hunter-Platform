# Hunter Platform — action_history 中间件 + INDUSTRY_MAP 扩展 Design

> **For agentic workers:** 这是 design spec，配套 implementation plan 在 `docs/superpowers/plans/2026-06-18-action-history-and-industry-map-plan.md`。

**Goal:** 补两个 v1.0.2 之后发现的小瑕疵：(1) `action_history` 表从不被任何 handler 写入；(2) `INDUSTRY_MAP` 只覆盖 13 家公司，大量候选人 `industry` 字段被错误归类或丢失。

**Architecture:** Task A 用 Express 中间件统一捕获 `/v1/auth/register` + 3 角色路由的请求/响应，fire-and-forget 写入 action_history；handler 通过 `res.locals` 给中间件补充业务上下文。Task B 把 INDUSTRY_MAP 数据移到 `config/industry_map.json`（与 `school_tiers.json` 对齐），mapping.ts 增加 fallback 模糊匹配。

**Tech Stack:** Express middleware, Node `crypto.randomUUID()`（已用）, `node:sqlite`（已用）, vitest + supertest（已用）

---

## 1. 背景与动机

### 1.1 action_history 缺口

**Spec §4.4.1 / §4.4.2 / §8.4 在三处明确要求写 action_history**，但代码层完全没有实现：

- `src/main/db/repositories/action-history.ts` 只有 `listByUser` 和 `countByUser` 两个方法，**没有 `insert`**
- 全 `src/main/` 没有 `INSERT INTO action_history` 语句
- 后果：admin 后台"审计日志"页面空白（v1.0.2 issue tracker）

### 1.2 INDUSTRY_MAP 缺口

- 当前 13 条（`src/main/modules/desensitize/mapping.ts:2-7`），只覆盖 互联网(8) + 通信/硬件(1) + 金融(5)
- 完全缺失：电商、教育、医疗、制造业、汽车、游戏、物流、半导体、央国企
- 未列名公司 fallback 到 `undefined`（导致 `candidates_anonymized.industry` 为 NULL）

### 1.3 设计原则

- **最小变更**：不重构现有 handler，只加中间件 + res.locals 装饰
- **数据驱动**：JSON 文件 + fallback 关键词规则（与 school_tiers.json 模式一致）
- **fire-and-forget**：action_history 写入失败不能阻塞 API 响应
- **不引入新依赖**

---

## 2. action_history 中间件设计

### 2.1 覆盖范围

中间件只挂在以下 4 个路由前缀：

| 前缀 | 覆盖的 endpoint |
|---|---|
| `/v1/auth/register` | POST register |
| `/v1/headhunter/*` | candidates / recommendations |
| `/v1/employer/*` | jobs / talent / recommendations/:id/{interest,unlock} |
| `/v1/candidate/*` | export / access-log |

**不覆盖**：
- `/v1/users/:id/status`、`/v1/users/:id/history`（查询类，按"最小化"决策）
- `/v1/skill.md`、`/v1/openapi.json`（静态资源）
- `/metrics`、`/healthz`（运维）
- 所有 admin IPC（Electron renderer ↔ main，独立审计走 `admin_action_log`）

### 2.2 路由 → action_type 映射表

| Method + Path | action_type |
|---|---|
| POST /v1/auth/register | `register` |
| POST /v1/headhunter/candidates | `upload_candidate` |
| POST /v1/headhunter/recommendations | `recommend_candidate` |
| DELETE /v1/headhunter/recommendations/:id | `withdraw_recommendation` |
| POST /v1/headhunter/candidates/:id/publish | `publish_to_pool` |
| GET /v1/headhunter/recommendations | `list_recommendations` |
| POST /v1/employer/jobs | `create_job` |
| GET /v1/employer/talent | `browse_talent` |
| POST /v1/employer/recommendations/:id/interest | `express_interest` |
| POST /v1/employer/recommendations/:id/unlock | `unlock_contact` |
| POST /v1/candidate/export | `export_data` |
| GET /v1/candidate/access-log | `view_access_log` |

未匹配 action_type → `unknown_<method>_<path_normalized>`

### 2.3 中间件契约

```ts
// src/main/modules/audit/action-history-middleware.ts
export interface ActionHistoryContext {
  user: { id: string };  // 来自 req.user（auth 中间件注入）
  action_type: string;
  target_type?: string;        // handler 可通过 res.locals.ahTargetType 覆盖
  target_id?: string;          // handler 可通过 res.locals.ahTargetId 覆盖
  req_summary?: object;        // handler 可通过 res.locals.ahReqSummary 覆盖
  res_summary?: object;        // handler 可通过 res.locals.ahResSummary 覆盖
}

export function createActionHistoryMiddleware(db: DB): RequestHandler;
```

**执行流程**：
1. 在 auth 中间件之后挂载（确保 `req.user` 已注入）
2. 记 `start = Date.now()`
3. 调 `next()`
4. 监听 `res.on('finish')`：
   - 计算 `duration_ms`
   - 提取 `action_type`（从 route map 查）
   - `status = res.statusCode < 400 ? 'success' : 'error'`
   - 错误时 `error_code = res.locals.errorCode ?? null`
   - `fireAndForget(insert({...}))`，错误仅打 `console.warn` 不抛

### 2.4 PII 安全约束

**强制规则**（在 helper 函数里 enforce，违反时 throw Error 让中间件跳过写入）：

```ts
const FORBIDDEN_KEYS = ['name', 'phone', 'email', 'password', 'token', 'api_key', 'apiKey'];
function sanitizeSummary(obj: object | undefined): object | null {
  if (!obj) return null;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
      throw new Error(`PII key detected in summary: ${key}`);
    }
  }
  return obj;
}
```

### 2.5 Handler 增强（最小化）

只在 3 处需要 `res.locals`：

| Handler | 文件:行 | res.locals 设置 |
|---|---|---|
| `headhunter.uploadCandidate` | `modules/headhunter/handler.ts:107` (return 前) | `ahTargetType='candidate'`, `ahTargetId=anonId`, `ahResSummary={anonymized_id, industry, title_level}` |
| `employer.expressInterest` | `modules/employer/handler.ts:156` (db.exec('COMMIT') 前) | `ahTargetType='recommendation'`, `ahTargetId=rec.id` |
| `employer.unlockContact` | `modules/employer/handler.ts:244` (COMMIT 前) | `ahTargetType='recommendation'`, `ahTargetId=rec.id` |

其他 9 个路由零修改。

### 2.6 Repo insert 方法

```ts
// src/main/db/repositories/action-history.ts 新增
const insertStmt = db.prepare(`
  INSERT INTO action_history (
    user_id, action_type, target_type, target_id,
    request_summary_json, response_summary_json,
    status, error_code, duration_ms, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

return {
  insert(entry: Omit<ActionHistoryEntry, 'id'>): void {
    insertStmt.run(
      entry.user_id, entry.action_type,
      entry.target_type ?? null, entry.target_id ?? null,
      entry.request_summary_json ?? null, entry.response_summary_json ?? null,
      entry.status, entry.error_code ?? null, entry.duration_ms ?? null,
      entry.created_at,
    );
  },
  // 保留原有 listByUser / countByUser
};
```

### 2.7 fire-and-forget 实现

```ts
function fireAndForget(promise: Promise<void> | void): void {
  try {
    Promise.resolve(promise).catch((e) => {
      console.warn('[action-history] insert failed:', e.message);
    });
  } catch (e) {
    console.warn('[action-history] sync error:', (e as Error).message);
  }
}
```

不用 setImmediate 队列（v1 用最简单的 try/catch），DB 慢时 Node 事件循环会自己排队。

---

## 3. INDUSTRY_MAP 扩展设计

### 3.1 JSON 文件结构

`config/industry_map.json`：

```json
{
  "version": 1,
  "updated_at": "2026-06-18",
  "categories": [
    { "id": "互联网",       "companies": ["字节跳动", "阿里巴巴", "腾讯", ...] },
    { "id": "金融",         "companies": ["招商银行", "中国银行", ...] },
    { "id": "通信/硬件",    "companies": ["华为", "中兴", "小米", "OPPO", ...] },
    { "id": "半导体",       "companies": ["中芯国际", "长江存储", "寒武纪", ...] },
    { "id": "电商",         "companies": ["阿里巴巴", "京东", "拼多多", ...] },
    { "id": "教育",         "companies": ["新东方", "好未来", "猿辅导", ...] },
    { "id": "医疗",         "companies": ["阿里健康", "京东健康", "平安好医生", ...] },
    { "id": "制造业",       "companies": ["比亚迪", "宁德时代", "美的", "格力", ...] },
    { "id": "汽车",         "companies": ["比亚迪", "蔚来", "理想", "小鹏", ...] },
    { "id": "游戏",         "companies": ["腾讯", "网易", "米哈游", "莉莉丝", ...] },
    { "id": "物流",         "companies": ["顺丰", "京东物流", "菜鸟", ...] },
    { "id": "央国企",       "companies": ["中石油", "中海油", "国家电网", ...] }
  ],
  "fallback_keywords": {
    "金融":      ["银行", "证券", "保险", "基金", "资本", "金融", "资产"],
    "互联网":    ["科技", "网络", "信息", "智能", "云", "数据", "AI"],
    "医疗":      ["医院", "健康", "医药", "生物", "制药", "基因"],
    "教育":      ["教育", "培训", "学校", "学堂"],
    "汽车":      ["汽车", "新能源", "电池", "电机"],
    "制造业":    ["制造", "工业", "装备", "重工"],
    "电商":      ["电商", "零售", "商城", "购物"],
    "游戏":      ["游戏", "娱乐", "传媒", "影业"],
    "物流":      ["物流", "快递", "供应链", "货运"],
    "通信/硬件": ["通信", "硬件", "芯片", "终端"]
  },
  "default": "其他"
}
```

**优先级**：枚举表（categories[].companies）> fallback 关键词 > default "其他"。

**多类别冲突**：同名公司按 JSON `categories[]` 数组顺序第一个生效（例如 "阿里巴巴" 在 互联网 第 2 个、在 电商 第 1 个 → 归 互联网；文档化说明）。

### 3.2 mapping.ts 改动

```ts
// src/main/modules/desensitize/mapping.ts 重构
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface IndustryConfig {
  version: number;
  updated_at: string;
  categories: { id: string; companies: string[] }[];
  fallback_keywords: Record<string, string[]>;
  default: string;
}

let _cache: { companies: Map<string, string>; cfg: IndustryConfig } | null = null;

function loadIndustryMap(): { companies: Map<string, string>; cfg: IndustryConfig } {
  if (_cache) return _cache;
  const path = join(process.cwd(), 'config', 'industry_map.json');
  let cfg: IndustryConfig;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // 兜底：文件丢失时用硬编码最小集
    cfg = { version: 0, updated_at: 'fallback', categories: [], fallback_keywords: {}, default: '其他' };
  }
  const companies = new Map<string, string>();
  for (const cat of cfg.categories) {
    for (const c of cat.companies) {
      if (!companies.has(c)) companies.set(c, cat.id); // first-wins
    }
  }
  _cache = { companies, cfg };
  return _cache;
}

export function lookupIndustry(companyName: string | undefined): string | undefined {
  if (!companyName) return undefined;
  const { companies, cfg } = loadIndustryMap();

  // 1. 枚举命中
  const hit = companies.get(companyName);
  if (hit) return hit;

  // 2. fallback 关键词（按 categories 顺序遍历，避免随机匹配）
  for (const cat of cfg.categories) {
    const keywords = cfg.fallback_keywords[cat.id] ?? [];
    if (keywords.some(k => companyName.includes(k))) {
      return cat.id;
    }
  }

  // 3. default
  return cfg.default;
}
```

`TITLE_LEVEL_PATTERNS`、`SALARY_BANDS`、`SCHOOL_TIERS` 保持不变。

### 3.3 engine.ts 调用点改动

```ts
// src/main/modules/desensitize/engine.ts
import { lookupIndustry } from './mapping.js';

// 在 desensitize() 内：
const industry = lookupIndustry(input.current_company);
// 不再读 INDUSTRY_MAP 直接 const
```

---

## 4. 测试策略

### 4.1 action_history 中间件测试（8 个 case）

`tests/integration/action-history-middleware.test.ts`：

1. register 成功 → 写入 `register / success`
2. upload_candidate 成功 → `target_type=candidate, target_id=anon_id, resSummary={anonymized_id,...}`
3. express_interest 成功 → `target_type=recommendation, target_id=rec_id`
4. 401 unauthorized → `status=error, error_code=UNAUTHORIZED`
5. 429 rate_limited → `status=error, error_code=RATE_LIMITED`
6. duration_ms > 0 且 < 10000（合理范围）
7. admin IPC 不写（白名单生效）
8. /v1/users/:id/status 不写（前缀白名单生效）

### 4.2 INDUSTRY_MAP 测试（6 个 case）

`tests/unit/desensitize-industry.test.ts`：

1. 枚举命中：字节跳动 → 互联网
2. JSON 顺序 first-wins：阿里巴巴 → 互联网（不在 电商）
3. fallback 命中：未列名 "宇宙银行" 包含 "银行" → 金融
4. fallback 未命中：完全无关 "某某工作室" → 其他
5. JSON 文件不存在 → 走兜底（"其他"），不抛错
6. 回归：原 13 条行为不变

---

## 5. 风险与边界

| 风险 | 缓解 |
|---|---|
| 中间件 fire-and-forget 失败导致审计缺失 | console.warn + 监控指标（M5 metrics hook 后续可加） |
| handler 误传 PII 到 res.locals.ahResSummary | sanitizeSummary 抛错让中间件跳过 |
| JSON 文件路径在 packaged Electron 内找不到 | loadIndustryMap 用 `process.cwd()` + try/catch 兜底 |
| 同名公司多类别 | 文档化 first-wins 语义，JSON 数组顺序人工控制 |
| 多 key 名冲突导致覆盖错 | 文档化（比亚迪同时在制造业和汽车，制造业在前 → 归制造业）|

---

## 6. 不在范围内（明确 YAGNI）

- LLM 自动行业分类（v2）
- action_history 异步队列持久化（M5 cron 已有 90 天清理）
- admin IPC 写 action_history（独立审计通道）
- /v1/users/:id/* 查询类写 action_history（最小化决策）
- action_history 分区表（v2 数据量再考虑）
- 国际化（中英文行业名同时支持）

---

## 7. 验收清单

- [ ] action_history 表 12 个 endpoint 全部覆盖
- [ ] admin 后台审计日志页面能看到 3 类（register/upload_candidate/express_interest）的真实数据
- [ ] INDUSTRY_MAP 包含 100+ 家公司 + 10+ fallback 关键词
- [ ] 现有 177 个测试 0 回归
- [ ] 新增 14 个测试（8 middleware + 6 industry）全过
- [ ] 0 typecheck 错误
- [ ] 2 个新 commit：`feat(audit): action_history middleware` + `feat(desensitize): industry_map json + fallback`