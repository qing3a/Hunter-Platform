# Hunter Platform 修复执行计划 v1.2：talent salary 范围过滤

> **任务**：补 `GET /v1/employer/talent` 的 `min_salary` / `max_salary` query 参数缺口，让 §14 skill 与代码 100% 对齐。
>
> **依据**：`docs/FIX_PLAN_v1.2_skill14.md` §14.3.1 提到 "⚠️ 没有 `salary_max` 参数"。本任务闭合此缺口。

---

## 上下文

- 服务：`http://localhost:3000`，源码 `D:\dev\hunter-platform`
- 当前分支：v1.1 clean baseline（373/373 测试通过、typecheck 0 errors）
- skill.md 现状：749 行，§14 已规划但**未实现**（独立 FIX_PLAN）
- CHANGELOG.md：已有 v0.3.0 / v0.3.1 / v1.1

---

## 涉及文件（已确认）

| 文件 | 用途 | 当前状态 |
|---|---|---|
| `src/main/modules/desensitize/mapping.ts` | `SALARY_BANDS` 常量定义（line 104-112） | 7 个 band：0-20万, 20-40万, 40-60万, 60-80万, 80-120万, 120-200万, 200万+ |
| `src/main/modules/employer/handler.ts` | `browseTalent` 函数（line 72-107） | 5 个 filter 字段，无 salary |
| `src/main/routes/employer.ts` | `talent` route（line 76-87） | 5 个 query 参数解析 |
| `src/shared/types.ts` 或 handler 内部 type | filter 类型定义 | 5 个字段 |
| `tests/integration/employer-handler.test.ts` | 现有 employer 测试（**无 talent 集成测试**） | 只有 express-interest 测试 |
| `docs/superpowers/skill.md` | Agent 文档 | §14.3.1 标了缺口 |
| `docs/CHANGELOG.md` | 变更日志 | 待追加 v1.2 |

---

## 关键设计决策

### 1. 语义：用 `min_salary`/`max_salary` 数字，与 `SALARY_BANDS` 求交集

**用户视角**：
```
GET /v1/employer/talent?min_salary=500000&max_salary=800000
→ "我要找年薪 50-80 万的候选人"
```

**映射逻辑**：
- 把数字范围 `[min_salary, max_salary]` 与 SALARY_BANDS 求交集
- 一个 band 与查询范围**有交集**就算命中：
  - `band.max >= min_salary`（band 不全在查询范围之下）
  - `band.min <= max_salary`（band 不全在查询范围之上；`band.max = NULL` 即 Infinity 也满足）
- 用命中 band 的 label 集合过滤 `candidates_anonymized.salary_range`

### 2. 边界行为

| 输入 | 行为 |
|------|------|
| `min_salary=400000, max_salary=600000` | 命中 `40-60万`（严格包含） |
| `min_salary=400000`（无 max） | 命中 `40-60万`, `60-80万`, `80-120万`, `120-200万`, `200万+` |
| `min_salary=0`（显式 0） | 命中所有 band（包含 `200万+` 因 max=NULL 视为 Infinity） |
| `min_salary=-1` 或 `max_salary=-1` | 视为无效 → 忽略该参数（不抛错，向后兼容） |
| `min_salary > max_salary` | 结果为空（不抛错） |
| `min_salary=2000000, max_salary=null` | 命中 `200万+`（max=NULL band） |
| 与 `skills` 等其他 filter 组合 | AND 关系 |

### 3. 数据库 schema 不变

`candidates_anonymized.salary_range` 是 TEXT 存 label（如 `"60-80万"`），不需要新增列或 migration。

### 4. 反向兼容

- 不传 `min_salary` / `max_salary`：行为不变（返回所有候选人）
- 已存在的 employer 测试不受影响

---

## T1：handler.ts 添 salary filter 字段

**文件**：`src/main/modules/employer/handler.ts`

**改动**（line 72-96 区域）：

```typescript
import { SALARY_BANDS } from '../desensitize/mapping.js';  // 新增 import

// 修改函数签名（line 72）
browseTalent(
  user: User,
  filters: {
    industry?: string;
    title_level?: string;
    min_years?: number;
    max_years?: number;
    skills?: string[];
    min_salary?: number;  // ← 新增
    max_salary?: number;  // ← 新增
  }
): AnonymizedCandidate[] {
  // ... 前面 quota 校验保持 ...

  // 新增：把 [min_salary, max_salary] 映射到 SALARY_BANDS 的 label 集合
  let allowedSalaryLabels: Set<string> | null = null;
  const min = (filters.min_salary != null && filters.min_salary >= 0) ? filters.min_salary : null;
  const max = (filters.max_salary != null && filters.max_salary >= 0) ? filters.max_salary : null;
  if (min != null || max != null) {
    allowedSalaryLabels = new Set(
      SALARY_BANDS
        .filter(b => {
          // band 与 [min, max] 有交集才算命中
          if (min != null) {
            const bandMax = b.max ?? Number.POSITIVE_INFINITY;
            if (bandMax < min) return false;  // band 全部 < min
          }
          if (max != null) {
            if (b.min > max) return false;   // band 全部 > max
          }
          return true;
        })
        .map(b => b.label)
    );
  }

  return all
    .filter(c => {
      if (filters.industry && c.industry !== filters.industry) return false;
      if (filters.title_level && c.title_level !== filters.title_level) return false;
      if (filters.min_years != null && (c.years_experience ?? 0) < filters.min_years) return false;
      if (filters.max_years != null && (c.years_experience ?? 0) > filters.max_years) return false;
      if (filters.skills && filters.skills.length > 0) {
        const candSkills: string[] = JSON.parse(c.skills_json ?? '[]');
        if (!filters.skills.some(s => candSkills.includes(s))) return false;
      }
      // ← 新增：salary range 过滤
      if (allowedSalaryLabels != null) {
        if (!c.salary_range) return false;  // 候选人无 salary_range 数据 → 排除
        if (!allowedSalaryLabels.has(c.salary_range)) return false;
      }
      return true;
    })
    .map(/* ... 保持不变 ... */);
}
```

**验证点**：
- import 路径 `from '../desensitize/mapping.js'` 与 `engine.ts` 用法一致
- `SALARY_BANDS` 的 type `{ min: number; max: number | null; label: string }[]`
- 不破坏现有 5 个 filter 的行为

---

## T2：routes/employer.ts 添 query 参数解析

**文件**：`src/main/routes/employer.ts`

**改动**（line 76-87 区域）：

```typescript
router.get('/talent', (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: any = {};
    if (req.query.industry)     filters.industry     = req.query.industry as string;
    if (req.query.title_level)  filters.title_level  = req.query.title_level as string;
    if (req.query.min_years)    filters.min_years    = Number(req.query.min_years);
    if (req.query.max_years)    filters.max_years    = Number(req.query.max_years);
    if (req.query.skills)       filters.skills       = String(req.query.skills).split(',');
    // ← 新增：
    if (req.query.min_salary)   filters.min_salary   = Number(req.query.min_salary);
    if (req.query.max_salary)   filters.max_salary   = Number(req.query.max_salary);
    const list = handler.browseTalent((req as typeof req & { user?: User }).user!, filters);
    res.json({ ok: true, data: list });
  } catch (e) { next(e); }
});
```

**验证点**：
- `Number('invalid')` 返回 `NaN`，handler.ts 已用 `>= 0` 过滤掉
- 与现有 `min_years` / `max_years` 模式一致

---

## T3：types 同步（filter 字段加 salary）

**文件**：`src/main/modules/employer/handler.ts`（已包含在 T1 改动内）+ 检查是否还有外部 type 引用

**步骤**：
```bash
grep -rn "browseTalent" d:/dev/hunter-platform/src --include="*.ts" 2>&1
```

如果只在 handler.ts 和 routes/employer.ts 用到，**无需新增 type 文件**。
如有外部 type 引用（如 types.ts 里的 interface），同步更新。

---

## T4：新增集成测试

**文件**：`tests/integration/employer-talent-filter.test.ts`（新建）

**原因**：现有 `employer-handler.test.ts` 只测 express-interest，没有 talent 测试。

**测试用例**（至少 4 个）：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

const testDb = path.join(__dirname, '../../tmp/talent-filter.db');
let app: any;

describe('GET /v1/employer/talent — salary filter', () => {
  let hhKey: string;
  let empKey: string;

  beforeAll(async () => {
    try { fs.unlinkSync(testDb); } catch {}
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.DATABASE_PATH = testDb;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../../src/main/server');
    app = createApp();

    // 注册 headhunter 并上传 3 个不同 salary 的候选人
    const hhRes = await request(app).post('/v1/auth/register')
      .send({ user_type: 'headhunter', name: 'Filter-HH', contact: 'fh@x.com' });
    hhKey = hhRes.body.data.api_key;
    const cand = await request(app).post('/v1/auth/register')
      .send({ user_type: 'candidate', name: 'C', contact: 'fc@x.com' });
    const candId = cand.body.data.id;

    // 上传 3 个：salary 触发 3 个不同 band
    // 注意 expected_salary 决定脱敏后的 salary_range
    for const [company, salary, title] of [
      ['字节跳动', 100000, 'P5 初级'],
      ['阿里巴巴', 500000, 'P6 高级'],
      ['腾讯',   1500000, 'P7+ 资深'],
    ] {
      await request(app).post('/v1/headhunter/candidates')
        .set('Authorization', `Bearer ${hhKey}`)
        .send({
          candidate_user_id: candId,
          name: 'x', phone: '1', email: 'a@b.com',
          current_company: company, current_title: title,
          expected_salary: salary, years_experience: 5,
          education_school: '清华大学', skills: ['React']
        });
    }

    // 公开到池子
    const list = await request(app).get('/v1/headhunter/candidates')
      .set('Authorization', `Bearer ${hhKey}`);
    for (const c of list.body.data) {
      await request(app).post(`/v1/headhunter/candidates/${c.anonymized_id}/publish-to-pool`)
        .set('Authorization', `Bearer ${hhKey}`);
    }

    // 注册 employer
    const empRes = await request(app).post('/v1/auth/register')
      .send({ user_type: 'employer', name: 'Filter-Emp', contact: 'fe@x.com' });
    empKey = empRes.body.data.api_key;
  });

  afterAll(() => { try { fs.unlinkSync(testDb); } catch {} });

  it('T-A: 无 salary filter 返回所有 3 个候选人', async () => {
    const r = await request(app).get('/v1/employer/talent')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('T-B: min_salary=400000 排除 < 40 万', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=400000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      // 命中的 band min ≥ 400000: 40-60万, 60-80万, 80-120万, 120-200万, 200万+
      expect(['40-60万', '60-80万', '80-120万', '120-200万', '200万+']).toContain(c.salary_range);
    }
  });

  it('T-C: max_salary=600000 排除 > 60 万', async () => {
    const r = await request(app).get('/v1/employer/talent?max_salary=600000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      // 命中的 band max ≤ 600000: 0-20万, 20-40万, 40-60万
      expect(['0-20万', '20-40万', '40-60万']).toContain(c.salary_range);
    }
  });

  it('T-D: min_salary=400000 + max_salary=800000 取交集', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=400000&max_salary=800000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      // 命中: 40-60万, 60-80万
      expect(['40-60万', '60-80万']).toContain(c.salary_range);
    }
  });

  it('T-E: max_salary=2000000 包含 200万+', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=2000000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    // 应包含 200万+ band 的候选人
    expect(r.body.data.some((c: any) => c.salary_range === '200万+')).toBe(true);
  });

  it('T-F: 与 industry 组合 AND', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=400000&industry=互联网')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    for (const c of r.body.data) {
      expect(c.industry).toBe('互联网');
      expect(['40-60万', '60-80万', '80-120万', '120-200万', '200万+']).toContain(c.salary_range);
    }
  });

  it('T-G: min > max 返回空数组（不报错）', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=2000000&max_salary=100000')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  it('T-H: 无效值（NaN）被忽略', async () => {
    const r = await request(app).get('/v1/employer/talent?min_salary=invalid')
      .set('Authorization', `Bearer ${empKey}`);
    expect(r.status).toBe(200);
    // 应返回所有候选人（filter 被忽略）
    expect(r.body.data.length).toBeGreaterThanOrEqual(3);
  });
});
```

**注意**：
- 必须先上传候选人并 `publish-to-pool`，否则 `is_public_pool = 0` 不在 talent 列表里
- 单个 candidate_user_id 反复上传会创建多条记录（前面 plan 解释过）——测试用一个 candidate_id 上传 3 次即可

---

## T5：更新 skill.md §14.3.1

**文件**：`docs/superpowers/skill.md`

**改动**：在 §14.3.1 找到 talent query 参数描述，改为：

```diff
- ⚠️ **query 参数只有这 5 个**（来自 `src/main/routes/employer.ts:78-83`）：
+ ✅ **query 参数共 7 个**（v1.2 新增 min_salary / max_salary）：

  ```python
  # 全部可选，可任意组合
  params = {
      'industry': '互联网',          # 完全匹配 candidates_anonymized.industry
      'title_level': 'P6',           # 完全匹配 title_level（如 'P6'、'P7+'、'M1'）
      'min_years': 5,                # years_experience ≥ N
      'max_years': 10,               # years_experience ≤ N
      'skills': 'React,TypeScript',  # 逗号分隔，任一命中即可（OR）
+     'min_salary': 500000,          # 年薪下限（含），与 SALARY_BANDS 求交集
+     'max_salary': 800000,          # 年薪上限（含），与 SALARY_BANDS 求交集
  }
  candidates = get('/v1/employer/talent', params=params)['data']
  ```

- ⚠️ **没有 `salary_max` 参数**！想过滤薪资得查 `/v1/config/salary_bands` 后用 title_level 间接过滤。
+ **salary 过滤语义**：数字与 `SALARY_BANDS` 求**交集**。例如 `min=400000, max=800000` 命中 `40-60万` 和 `60-80万`。边界：band.max=NULL（即 `200万+`）视为 Infinity。
+ **组合关系**：salary filter 与其他 filter 是 AND。
+ **异常处理**：`min > max` 返回空数组（不报错）；`min_salary=invalid`（NaN）被忽略，返回所有。
```

---

## T6：追加 CHANGELOG.md v1.2

**文件**：`docs/CHANGELOG.md`

在 v1.1 之后追加 v1.2 节：

```markdown
## v1.2 — 2026-06-19

### ✨ 新增功能

| 端点变化 | 说明 |
|------|------|
| `GET /v1/employer/talent` 新增 `min_salary` / `max_salary` query 参数 | 数字与 `SALARY_BANDS` 求交集过滤；与现有 filter AND 组合；min > max 返回空 |

### 📖 文档

- `docs/superpowers/skill.md` §14.3.1：补全 7 个 query 参数说明
- `docs/FIX_PLAN_v1.2_skill14.md`：skill 章节（独立 plan）
- `docs/FIX_PLAN_v1.2_salary_filter.md`：本任务执行计划

### ✅ 验证

- 新增 8 个集成测试（tests/integration/employer-talent-filter.test.ts）
- `pnpm test` 期望：≥ 381 / 381 PASS（373 + 8）
```

---

## T7：跑测试 + typecheck 验证

```bash
cd d:/dev/hunter-platform

# 1. 类型检查
pnpm typecheck

# 2. 单元 + 集成测试
pnpm test

# 3. 期望结果
# - Test Files: 89 passed (88 + 1 新增)
# - Tests: 381 passed (373 + 8 新增)
# - 0 failures

# 4. 手动 smoke test（可选）
# 启动服务，跑一个 talent 查询验证
curl -H "Authorization: Bearer <emp_key>" \
  "http://localhost:3000/v1/employer/talent?min_salary=400000&max_salary=800000" \
  | python -c "import sys,json;d=json.load(sys.stdin);print(f'count={len(d[\"data\"])}')"
```

---

## 🚫 不要做的事

- ❌ 不要新增 DB migration（schema 不变）
- ❌ 不要修改 `candidates_anonymized` 表结构
- ❌ 不要修改 `SALARY_BANDS` 常量
- ❌ 不要碰其他 route（只改 talent）
- ❌ 不要修改 §14 之外的其他 skill.md 内容
- ❌ 不要新增 env 变量
- ❌ 不要修改其他 handler / route
- ❌ 不要修改 CHANGELOG.md 现有内容（只追加 v1.2）
- ❌ 不要触碰 F1-F11 / v008 / AUDITED_PREFIXES 修复（避免回归）
- ❌ 不要删除任何已通过的测试用例

---

## 工作时间估计

- T1 + T2: 15 分钟
- T3: 2 分钟（检查）
- T4: 15 分钟（写 8 个测试用例 + 调试）
- T5 + T6: 10 分钟
- T7: 5 分钟

**总计：~45 分钟**

---

## 验收清单

完成后报告：

1. **修改文件清单**（应有 5 个）：
   - `src/main/modules/employer/handler.ts`
   - `src/main/routes/employer.ts`
   - `tests/integration/employer-talent-filter.test.ts`（新建）
   - `docs/superpowers/skill.md`
   - `docs/CHANGELOG.md`

2. **验证输出**：
   - `pnpm typecheck` 输出（应 0 errors）
   - `pnpm test` 最后 5 行（应 Test Files 89 passed, Tests ≥ 381 passed）

3. **手动 smoke test 输出**：
   - curl 调用 talent 的响应摘要

---

## 给执行 AI 的关键提示

1. **SALARY_BANDS 的 import 路径**：从 `employer/handler.ts` 出发是 `'../desensitize/mapping.js'`（**注意 .js 后缀**，TypeScript ESM 编译要求）
2. **browseTalent 内部用 in-memory filter**（line 82-97）：fetch all then filter。新增的 salary filter 走同样模式，**不要改 SQL**——保持一致
3. **publish-to-pool 必须先调**：测试里 3 个候选人都要 `POST /v1/headhunter/candidates/{id}/publish-to-pool` 才能在 talent 里看到（`is_public_pool=1`）
4. **测试用一个 candidate_id 上传 3 次**：headhunter 重复上传同一 user_id 会创建多条 anonymized 记录——这正是我们要测的多 salary 场景
5. **SALARY_BANDS 的 max=null 行为**：代码里用 `b.max ?? Number.POSITIVE_INFINITY` 处理
6. **测试文件位置**：`tests/integration/employer-talent-filter.test.ts`（**新建**，不修改任何已有测试）
7. **pnpm test 是 vitest**：直接 `pnpm test` 跑全部；想单跑这一文件：`npx vitest run tests/integration/employer-talent-filter.test.ts`
