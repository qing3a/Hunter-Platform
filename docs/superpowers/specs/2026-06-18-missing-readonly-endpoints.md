# Missing Read-Only API Endpoints — Spec

**状态**: Draft
**日期**: 2026-06-18
**作者**: brainstorming session
**前置文档**: [2026-06-17-hunter-platform-design.md](./2026-06-17-hunter-platform-design.md), [docs/superpowers/skill.md](../skill.md)

---

## 1. 概述

### 1.1 一句话定义

补齐 skill.md §3.3 / §3.5 列出的 5 个未实现 endpoint：
- `GET /v1/config/industries`
- `GET /v1/config/title_levels`
- `GET /v1/config/salary_bands`
- `GET /v1/market/leaderboard`
- `GET /v1/headhunter/candidates`

### 1.2 触发原因

真实 end-to-end 测试发现这 5 个 endpoint 在 `src/main/routes/*.ts` 中**完全没有 router 注册**，调用都返回 404。

### 1.3 目标

1. 5 个 endpoint 都返回 200 + 正确数据形状
2. 全部需要 Bearer auth（与现有 `users/{id}/status` 一致）
3. 每个 endpoint 扣 1 quota（skill.md 声明）
4. 字段命名遵循 Convention A（自用 `id`，外键 `xxx_id`）

### 1.4 非目标

- 不实现筛选/分页（v1 仅简单返回 top 10 / first 50）
- 不缓存（数据量小，每次 DB 查）
- 不修改 desensitize 模块（只读取现有常量）

---

## 2. 端点设计

### 2.1 `GET /v1/config/industries`

- **Auth**: Bearer required
- **Quota**: 1
- **数据源**: `src/main/modules/desensitize/mapping.ts` 的 `industry_map.json`（通过 `loadIndustryMap()` 暴露）
- **Response**:
```json
{
  "ok": true,
  "data": [
    { "id": "互联网", "companies_count": 7 },
    { "id": "金融", "companies_count": 5 },
    { "id": "通信/硬件", "companies_count": 1 }
  ]
}
```

### 2.2 `GET /v1/config/title_levels`

- **Auth**: Bearer required
- **Quota**: 1
- **数据源**: `TITLE_LEVEL_PATTERNS` 常量
- **Response**:
```json
{
  "ok": true,
  "data": [
    { "code": "P6", "match": "P[5-7]|高级工程师|..." },
    { "code": "P7+", "match": "P[8-9]|资深|专家|Staff" },
    { "code": "M1", "match": "M[1-2]|经理|主管" },
    { "code": "M2", "match": "M[3-4]|总监" },
    { "code": "VP", "match": "VP|副总裁|总裁" }
  ]
}
```

### 2.3 `GET /v1/config/salary_bands`

- **Auth**: Bearer required
- **Quota**: 1
- **数据源**: `SALARY_BANDS` 常量
- **Response**:
```json
{
  "ok": true,
  "data": [
    { "label": "0-20万", "min": 0, "max": 200000 },
    { "label": "20-40万", "min": 200000, "max": 400000 },
    { "label": "40-60万", "min": 400000, "max": 600000 }
  ]
}
```

### 2.4 `GET /v1/market/leaderboard`

- **Auth**: Bearer required
- **Quota**: 1
- **排序**: `users.reputation DESC`（已确认选择"信誉分"）
- **限制**: top 10
- **数据源**: DB 直接查（active headhunter）
- **Response**:
```json
{
  "ok": true,
  "data": [
    { "rank": 1, "id": "user_xxx", "name": "Top HH", "reputation": 95 },
    { "rank": 2, "id": "user_yyy", "name": "Second HH", "reputation": 88 }
  ]
}
```

### 2.5 `GET /v1/headhunter/candidates`

- **Auth**: Bearer required
- **Quota**: 1
- **数据源**: `candidates_anonymized` 表，where `source_headhunter_id = req.user.id`
- **Response**:
```json
{
  "ok": true,
  "data": [
    {
      "anonymized_id": "ca_xxx",
      "industry": "互联网",
      "title_level": "P6",
      "years_experience": 8,
      "salary_range": "60-80万",
      "education_tier": "985",
      "skills": ["React", "TypeScript"],
      "is_public_pool": false,
      "created_at": "2026-06-18T..."
    }
  ]
}
```

---

## 3. 文件级变更

### 3.1 新增

| 文件 | 用途 |
|------|------|
| `src/main/routes/config.ts` | 3 个 config endpoint 路由 |
| `src/main/routes/market.ts` | leaderboard 路由 |
| `tests/integration/config-endpoints.test.ts` | 3 个 config endpoint 测试 |
| `tests/integration/market-leaderboard.test.ts` | leaderboard 测试 |
| `tests/integration/headhunter-candidates-list.test.ts` | GET /v1/headhunter/candidates 测试 |

### 3.2 修改

| 文件 | 改动 |
|------|------|
| `src/main/routes/headhunter.ts` | 加 `router.get('/candidates', ...)` |
| `src/main/server.ts` | 注册 `config` 和 `market` 路由 |

### 3.3 不动

- `src/main/modules/desensitize/mapping.ts`（仅读取现有常量）
- `src/main/db/repositories/*`（candidates_anonymized 已有 `findByHeadhunterId` 或类似方法）
- `src/main/modules/employer/handler.ts`（leaderboard 可直接查 DB，不走 handler）

---

## 4. 数据流

### 4.1 Config endpoints

```
Client → GET /v1/config/industries
       ↓
authMiddleware → 鉴权
       ↓
quota.tryConsume(user.id, QUOTA_COSTS.config_lookup) → 1
       ↓
configRouter('/industries') → 直接 import & 返回 loadIndustryMap() 的 categories
       ↓
{ ok: true, data: [{ id, companies_count }] }
```

### 4.2 Leaderboard

```
Client → GET /v1/market/leaderboard
       ↓
authMiddleware + quota
       ↓
db.prepare('SELECT id, name, reputation FROM users WHERE user_type = ? AND status = ? ORDER BY reputation DESC LIMIT 10')
       ↓
map 加 rank 字段
       ↓
{ ok: true, data: [{ rank, id, name, reputation }] }
```

### 4.3 Headhunter candidates list

```
Client → GET /v1/headhunter/candidates (Bearer)
       ↓
authMiddleware (确保 user.user_type === 'headhunter')
       ↓
quota.tryConsume
       ↓
candidatesAnon.findByHeadhunterId(user.id)
       ↓
{ ok: true, data: [CandidateRow] }
```

---

## 5. 错误处理

| 场景 | HTTP |
|------|------|
| 无 Bearer | 401 UNAUTHORIZED |
| Bearer 无效 | 401 |
| 配额耗尽 | 429 INSUFFICIENT_QUOTA |
| 非 headhunter 调 /v1/headhunter/candidates | 403 FORBIDDEN |
| 其他错误 | 500 INTERNAL_ERROR |

---

## 6. 测试策略

每个 endpoint 至少 2 个 test：

| Endpoint | 测试 |
|----------|------|
| /v1/config/industries | ① 200 + data 是 array of `{id, companies_count}` ② 无 auth → 401 |
| /v1/config/title_levels | ① 200 + 包含 P6/P7+/M1/M2/VP ② 无 auth → 401 |
| /v1/config/salary_bands | ① 200 + 包含至少 3 个 band ② 无 auth → 401 |
| /v1/market/leaderboard | ① 200 + 多个 headhunter 按 reputation DESC 排序 ② 无 auth → 401 |
| /v1/headhunter/candidates | ① headhunter 可看自己的候选人 ② employer 调 → 403 ③ 空列表（无候选人时） |

**总计**: ~10 个新 test

---

## 7. 实现路径

按 TDD，每个 endpoint 一个 Task：

1. **T1**: `GET /v1/config/industries` (RED → GREEN)
2. **T2**: `GET /v1/config/title_levels` (RED → GREEN)
3. **T3**: `GET /v1/config/salary_bands` (RED → GREEN)
4. **T4**: `GET /v1/market/leaderboard` (RED → GREEN)
5. **T5**: `GET /v1/headhunter/candidates` (RED → GREEN)
6. **T6**: 全测试 + typecheck + commit + push

预计代码：~300 行（路由 + handlers + 10 个 tests）。

---

## 8. 决策记录

| 决策 | 选择 | 备选 |
|------|-----|------|
| Auth | 全部需要 Bearer | config 公开（与现有惯例不一致） |
| Leaderboard 指标 | reputation DESC | placement_count / unlock_count / 综合 |
| Leaderboard 限制 | top 10 | top 20 / 全量 |
| 分页 | 无 | limit/offset 参数 |
| 行业数据源 | 现有 industry_map.json（通过 desensitize 模块） | 新建独立 endpoint + 数据 |
| 路由文件 | 新建 config.ts + market.ts | 合并到 employer.ts 或 users.ts |