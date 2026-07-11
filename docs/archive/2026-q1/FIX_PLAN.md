# Hunter Platform 修复记录（v1.1）

> 此文档记录 v1 → v1.1 期间的修复工作。  
> 实时状态以源码为准；skill.md 是 Agent 接入文档。

---

## 总览

| 阶段 | 工作 | 状态 | 验证 |
|------|------|------|------|
| **F1** | 全局 404 JSON 兜底 | ✅ 完成 | 未匹配路由返 `{"ok":false,"error":{"code":"NOT_FOUND",...}}` |
| **F2** | `/v1/config/*` + `/v1/market/leaderboard` 改 `optionalAuth` | ✅ 完成 | 无 auth 返 200，authed 时填充 `req.user` |
| **F3** | `contact` 跨 `user_type` 允许重复；新错误码 `CONTACT_TAKEN` | ✅ 完成 | 同 role 24h 内禁、跨 role 区分信息 |
| **F4** | `action_type` 枚举 + fallback 用 last resource segment | ✅ 完成 | 历史记录全是枚举，不再 `unknown_<full_path>` |
| **F5** | `POST /v1/auth/rotate-key` + 24h grace period | ✅ 完成 | 旧 key 24h 内仍可用 |
| **F6** | `POST /v1/candidate/delete-my-data` GDPR 软删 | ✅ 完成（**含 v008 修复**） | PII 抹除、key 立即失效 |
| **F7** | `GET /v1/users/{id}/history` | ✅ 完成（**含 AUDITED_PREFIXES 修复**） | 列出本人操作历史 |
| **F8** | OpenAPI 重写至 29 路径 | ✅ 完成 | 与代码一致 |
| **F9** | skill.md 路径名 + 错误码同步 | ✅ 完成 | 与代码一致 |
| **F10** | 7 个验收命令 | ✅ 完成 | 23/23 PASS |
| **F11** | E2E happy path | ✅ 完成 | 注册→上传→推荐→解锁→placement 全通 |

---

## ⚠️ v1.0 → v1.1 期间的隐藏 bug 修复

> 由"接收其他 AI 代码评审"流程发现并修复。  
> 其他 AI 的修复 prompt 自报"全过"，但实际隐藏 3 处问题。

### B1: GDPR schema migration 缺失
- **症状**：`POST /v1/candidate/delete-my-data` 抛 500 `NOT NULL constraint failed: users.name`
- **根因**：v001 schema 把 `users.name`、`candidates_private.{name_enc, phone_enc, email_enc}` 设为 NOT NULL，GDPR handler 试图 set NULL 失败
- **修复**：`src/main/db/migrations/v008_gdpr_nullable.sql`（新增）—— 12-step recreate 模式，含 v006/v007 全部 18 列

### B2: `/v1/auth/rotate-key` 没被审计
- **症状**：`action_history` 表无 `rotate_api_key` 记录
- **根因**：`AUDITED_PREFIXES = ['/v1/auth/register', '/v1/headhunter', ...]`，rotate-key 不在名单
- **修复**：`src/main/server.ts` 改为 `['/v1/auth', '/v1/users', '/v1/headhunter', '/v1/employer', '/v1/candidate']` 前缀匹配

### B3: migration 测试期望过期
- **症状**：`pnpm test` 报 2 个 fail：`migrations-v002.test.ts`、`migrations-v003.test.ts`
- **根因**：其他 AI 加了 v008，但测试硬编码期望 `[1,2,3,4,5,6,7]`
- **修复**：测试期望更新为 `[1,2,3,4,5,6,7,8]`

---

## 最终验收

### 自动化测试
- `pnpm test`: **373 / 373 PASS**（88 个测试文件）
- `pnpm typecheck`: **0 errors**

### 行为验证（23 项）
| 类别 | 通过 |
|---|---|
| F5 rotate-key + grace period | 5/5 |
| F6 delete-my-data GDPR | 3/3 |
| F7 history 审计 | 2/2 |
| F8 OpenAPI | 2/2 |
| F9 skill.md 一致性 | 4/4 |
| P0-1 中文输出 | 4/4 |
| P1-3 / P1-4 | 3/3 |

### E2E Happy Path
```
注册 → 上传 (industry=互联网, title=P6, edu=985)
  → 雇主发 JD → 猎头推荐
  → 雇主表达兴趣 → 候选人授权
  → 雇主解锁 → 雇主创建 placement
全 200
```

### view_url 单次有效
- 第一次 GET → 200 + 含脱敏数据
- 第二次 GET → 410 Gone
- 第三次 GET → 410 Gone

### Webhook 投递
- `deliver_contact` 事件收到
- HMAC-SHA256 签名验证合法（`crypto.timingSafeEqual`）
- 时间戳合法（`|now - ts| < 300s`）
- body 含明文 PII：name、phone、email

---

## 配置变更（v1.0 → v1.1）

### 新增 env 变量
```bash
# 关闭所有限流（per-user sliding window + IP register）
# 仅用于本地开发/测试；生产保持默认（开启）
RATE_LIMIT_ENABLED=false  # 默认 true
```

### 新增 DB migration
- `v008_gdpr_nullable.sql` —— users/candidates_private 的 PII 字段改为 nullable

### 新增 API 端点
- `POST /v1/auth/rotate-key`（v1 仅本人）
- `POST /v1/candidate/delete-my-data`（v1 仅本人 candidate）
- `GET /v1/users/{id}/history`（v1 仅本人，`?limit=`、`?since=`）

### 新增错误码
- `CONTACT_TAKEN`（409，contact 已被同 role 或跨 role 占用）
- `NOT_IMPLEMENTED`（501，未来路由占位）
- `INVALID_CHARSET`（400，请求体非 UTF-8）
- `INVALID_CONTENT_TYPE`（400，非 application/json）
- `INVALID_JSON`（400，JSON 解析失败）
- `PAYLOAD_TOO_LARGE`（413，> 4KB）

---

## 教训（给未来接手的人）

按 `receiving-code-review` skill 严格执行：

1. **不要信"全过"字面意思** —— 独立跑 `pnpm test` 才知有 2 个 fail
2. **不要信"功能 OK"** —— 跑真实路径才知 schema 不允许 NULL
3. **不要信"audit 已加"** —— 看代码才知中间件没挂上
4. **独立验证每个 claim**，附证据（curl 输出、DB 查询、测试结果）
5. **schema 变更一定要写 migration**，不要直接 ALTER
6. **新增中间件要更新到 prefix 名单**（如 `AUDITED_PREFIXES`）
7. **测试期望里硬编码的版本号**要随 migration 同步更新

---

## 仍待办（不在 v1.1 范围）

- ⚪ /v1/auth/rotate-key rotate 后**审计摘要**还需 skill.md 例子
- ⚪ /v1/config/market 改 optional-auth 后，限流是否仍生效待验（开启限流场景）
- ⚪ OpenAPI spec 完整 schema 校验（路径数 ✓，每个 path 的 request/response schema 是否完整）
- ⚪ 真实生产部署（无 git 仓库，无 deploy context）
