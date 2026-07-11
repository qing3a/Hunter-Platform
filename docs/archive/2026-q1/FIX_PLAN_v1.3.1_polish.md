# Hunter Platform 修复执行计划 v1.3.1：skill.md polish 收尾

> **任务**：6 项剩余 polish 修复 + 验证
>
> v1.3 已做大部分，剩余 6 项小修补

---

## 上下文

- 服务跑在 `http://localhost:3000`，源码 `D:\dev\hunter-platform`
- v1.3 已合并：13 项 doc polish + 1 项新 endpoint（`/v1/market/jobs`）
- 测试 387/387 通过

---

## 本轮剩余 6 项

| # | 位置 | 当前问题 | 修复 |
|---|------|---------|------|
| A | §5.6 unlimited 清单 | 漏列 `/v1/market/jobs`（v1.3 新增的） | 加入 |
| B | §0.4 PII 表 | 未引用 §2.3 的 commission_split 说明 | 加一行 cross-ref |
| D | §6.2 webhook 签名 | 没说 agent 怎么获得 `WEBHOOK_HMAC_SECRET` | 加说明（v1 设计缺口） |
| F | §11.3 猎头推荐步骤 | "v1.3 新流程"注释夹在代码中间，步骤 1 之前没有 | 移到步骤 1 之前 |
| G | §0.3 4 步解锁 | "回退（详见 §7）" 含义模糊 | 加具体例子 |
| K | §6.3 重试策略 | "3 次重试"让 agent 误以为是 agent 行为 | 加 "(平台策略，agent 接收方不触发)" |

## 本轮跳过（v1.3 已做）

| # | 原因 |
|---|------|
| C §5.2 (UTC) | "0 点 UTC 重置" 已在 §5.1 写明 |
| E §2.x 配额 | v1.3 已有 rotate-key=1, history=1, delete-my-data=1 |
| H §4.3 合法 UTF-8 | v1.3 已有"合法 UTF-8 字节（包括 emoji、组合字符）均通过" |
| I §5.4 注释 | v1.3 已有"按当前 user_type 取值" |
| J §6.2 常量时间 | v1.3 已有"接收方应做**常量时间比较**" |

---

## 涉及文件

只改 1 个文件：**`docs/superpowers/skill.md`**
+ 1 个 changelog：**`docs/CHANGELOG.md`**

---

## T1：6 项编辑

### T1-A：§5.6 加 `/v1/market/jobs`

**位置**：`docs/superpowers/skill.md` §5.6（行号 ~341）

**当前**：
```
`/v1/auth/register`（独立 IP 限流）/ `/v1/health` / `/v1/skill.md` / `/v1/openapi.json` / `/v1/config/*` / `/v1/market/leaderboard` / `/` (landing) / `/view/*` / `/v1/views/*` / `/metrics`
```

**改为**：
```
`/v1/auth/register`（独立 IP 限流）/ `/v1/health` / `/v1/skill.md` / `/v1/openapi.json` / `/v1/config/*` / `/v1/market/leaderboard` / `/v1/market/jobs` / `/` (landing) / `/view/*` / `/v1/views/*` / `/metrics`
```

---

### T1-B：§0.4 PII 表加 cross-ref

**位置**：`docs/superpowers/skill.md` §0.4 PII 表下方

**当前**（在表格后）：

```
| `expected_salary` / `years_experience` / `skills` | 明文 | 仅返回脱敏后版本（`salary_range`） |

---
```

**改为**：

```
| `expected_salary` / `years_experience` / `skills` | 明文 | 仅返回脱敏后版本（`salary_range`） |

> 💡 **跨猎头分账**：commission 不通过 placement body 传递，由推荐时的 `referrer_headhunter_id` + `commission_split` 自动计算（详见 §2.3）。

---
```

---

### T1-D：§6.2 加 webhook secret 交付说明

**位置**：`docs/superpowers/skill.md` §6.2 webhook 签名（行号 ~388）

**当前**：
```
### 6.2 签名验证

平台用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256：
```

**改为**：

```
### 6.2 签名验证

平台用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256。

> ⚠️ **v1 设计缺口**：当前 secret 通过环境变量（`.env`）配置，**没有**注册时自动交付的机制。Agent 接入时需：
> 1. 部署方在 `.env` 中配置 `WEBHOOK_HMAC_SECRET=<strong-random-string>`
> 2. 在接收端用相同 secret 验证签名
> 3. 接收端从 `X-Hunter-Timestamp` + `X-Hunter-Signature` 头验证（公式见下）
> 
> v2 计划：在 `POST /v1/auth/register` 时返回 per-user secret，或新增 `GET /v1/webhook/secret` 端点。

平台用 `WEBHOOK_HMAC_SECRET` 做 HMAC-SHA256：
```

---

### T1-F：§11.3 移动 v1.3 注释

**位置**：`docs/superpowers/skill.md` §11.3（行号 ~555-565）

**当前**：
```python
# 雇主发 JD
job = auth_post('http://localhost:3000/v1/employer/jobs', {
    'title': '高级前端工程师', 'description': '8年以上 React 经验',
    'required_skills': ['React', 'TypeScript'],
    'salary_min': 500000, 'salary_max': 800000,
}, keys['employer'])
job_id = job['data']['id']

# 💡 新流程（v1.3 起）：猎头想看市场所有 open JD，用公共端点：
# jobs = get('/v1/market/jobs?industry=互联网')['data']
# 不再需要"猎头先注册雇主身份"或"让雇主主动 push"。

# 猎头推荐给这个 job
```

**改为**（把"新流程"注释移到 §11.3 开头）：

在 §11.3 标题下方第一行之前加：

```python
# 💡 新流程（v1.3 起）：猎头想看市场所有 open JD，用公共端点：
# jobs = get('/v1/market/jobs?industry=互联网')['data']
# 不再需要"猎头先注册雇主身份"或"让雇主主动 push"。

# 雇主发 JD
```

---

### T1-G：§0.3 4 步解锁加"回退"例子

**位置**：`docs/superpowers/skill.md` §0.3 后（行号 ~46-48）

**当前**：
```
> ⚠️ **重要**：4 步必须按顺序；任何一步失败都会触发状态机非法转换（`409 INVALID_STATE`），需要回退（详见 §7）。
```

**改为**：

```
> ⚠️ **重要**：4 步必须按顺序；任何一步失败都会触发状态机非法转换（`409 INVALID_STATE`）。
> 
> **回退示例**：
> - unlock 失败 → 候选人需重新 `POST /approve-unlock`，再走 employer `/unlock-contact`
> - 候选人 reject → 同一 `(候选人, job)` 对不能再次 recommend，换 job 或换候选人
> - employer 撤回了 express-interest → 同一 rec 需重新从 step 2 开始
```

---

### T1-K：§6.3 加 "(平台策略)"

**位置**：`docs/superpowers/skill.md` §6.3（行号 ~409）

**当前**：
```
### 6.3 重试

3 次重试，指数退避（1s / 4s / 16s）。失败入 `dead_letter`（v1 手动重投）。

> ⚠️ **webhook 是解锁流程的唯一交付通道**：候选人 PII 不会通过 unlock-contact 的 response body 返回，必须等 webhook 推送。建议 agent 用长连接 + 离线队列接收。
```

**改为**：

```
### 6.3 重试

3 次重试，指数退避（1s / 4s / 16s）。失败入 `dead_letter`（v1 手动重投）。

> ⚠️ **平台策略**（agent 接收方不触发）：以上重试是平台在投递 webhook 失败时自动做的；agent 作为接收方不会触发这条逻辑。如果你的 webhook 长期 5xx，请联系平台运维。
> 
> ⚠️ **webhook 是解锁流程的唯一交付通道**：候选人 PII 不会通过 unlock-contact 的 response body 返回，必须等 webhook 推送。建议 agent 用长连接 + 离线队列接收。
```

---

## T2：CHANGELOG 加 v1.3.1

**位置**：`docs/CHANGELOG.md` 顶部

**当前**（v1.3 是最新）：

```
## v1.3 — 2026-06-19
...
```

**改为**（在最顶部加 v1.3.1）：

```
## v1.3.1 — 2026-06-19

### 🧹 文档 polish（6 项收尾）

- §5.6 unlimited 清单补 `/v1/market/jobs`（v1.3 漏列）
- §0.4 PII 表加 cross-ref 指向 §2.3 commission_split 说明
- §6.2 加 webhook secret 交付说明（v1 设计缺口 + v2 计划）
- §11.3 移动 v1.3 market jobs 注释到步骤开头
- §0.3 加 4 步解锁的"回退"具体例子
- §6.3 标注"3 次重试"是平台策略（agent 不触发）

### 验证

- `pnpm test`: 387/387 PASS
- `pnpm typecheck`: 0 errors
- 0 行代码改动
```

---

## T3：验证

```bash
cd d:/dev/hunter-platform

# 1. 类型检查（应该 0 errors，纯文档改动不应影响）
pnpm typecheck

# 2. 测试（应仍是 387/387）
pnpm test
```

**期望**：
- TypeScript: 0 errors
- Test Files: 90 passed
- Tests: 387 passed

---

## 🚫 不要做的事

- ❌ 不要修改源代码
- ❌ 不要修改任何测试
- ❌ 不要修改其他文档
- ❌ 不要修改 §9 / §10（运维内容，单独 task）
- ❌ 不要修改 §13 SDK 示例
- ❌ 不要添加 §14（独立 task）
- ❌ 不要修改 OpenAPI

---

## 硬约束

- ✅ 只改 2 个文件：
  - `docs/superpowers/skill.md`
  - `docs/CHANGELOG.md`
- ✅ 6 项编辑按 T1-A → T1-K 顺序
- ✅ 每完成 2-3 项用 `grep` 验证关键字存在
- ✅ 完成后跑 `pnpm test` 确认 387/387

---

## 关键陷阱

1. **§5.6 编辑位置**（T1-A）：
   - 当前末尾是 `/metrics`
   - 在 `/v1/market/leaderboard` 后、`/` 前插入 `/v1/market/jobs`
   - 确认插入后是 `/v1/market/leaderboard` / `/v1/market/jobs` / `/` ...

2. **§0.4 编辑位置**（T1-B）：
   - 在 `| expected_salary ... |` 行**之后**、空行+`---` **之前**
   - 不要破坏表格

3. **§11.3 编辑**（T1-F）：
   - §11.3 标题下**第一段代码前**
   - 不要破坏后续 `e2e.py` 整体流程

4. **§6.2 加说明**（T1-D）：
   - 注意：当前 §6.2 标题后是 "平台用 WEBHOOK_HMAC_SECRET 做 HMAC-SHA256：" 后面直接跟代码块
   - **新位置**：在标题后、那段文字前加 ⚠️ callout
   - 这样顺序是：标题 → ⚠️ callout（设计缺口）→ 平台用... 介绍 → 代码块

5. **§6.3 编辑**（T1-K）：
   - "3 次重试" 行后
   - 在原 ⚠️ webhook 提示**前**插入新的 ⚠️ 平台策略说明

6. **CHANGELOG 顺序**：
   - 倒序：v1.3.1 → v1.3 → v1.2 → v1.1 → v0.3.1 → v0.3.0
   - 不要把 v1.3.1 放在 v1.3 下面

---

## 卡住时怎么办

- grep 找不到目标文字 → 先用 `grep -n` 确认精确行号
- Edit 失败（文件已修改）→ Read 重新读
- 不确定某项要不要做 → 跳过该项，标记"已 skip"，在报告里说明
- 测试挂了 → 不要动源码，退回报告

---

## 验收清单

完成后报告：

1. **修改文件清单**（应 2 个）：
   - docs/superpowers/skill.md
   - docs/CHANGELOG.md

2. **6 项编辑确认**（每项用 grep 验证关键字）：
   - A: `grep "/v1/market/jobs" docs/superpowers/skill.md` 至少 5 次（§2.5 + §5.6 + §11.3 + changelog + ...）
   - B: `grep "commission_split" docs/superpowers/skill.md` 至少 5 次
   - D: `grep "WEBHOOK_HMAC_SECRET" docs/superpowers/skill.md` 至少 2 次
   - F: §11.3 步骤 1 之前有"新流程"注释
   - G: §0.3 包含"回退示例"
   - K: §6.3 包含"平台策略"

3. **验证输出**：
   - pnpm typecheck（0 errors）
   - pnpm test（387/387 passed）

4. **任何跳过的项 + 原因**

---

## 工作时间估计

- T1（6 项文档）：~20 分钟
- T2（CHANGELOG）：~3 分钟
- T3（验证）：~2 分钟

**总计：~25 分钟**
