# Hunter Platform Skill.md Upgrade — Phase 1 (P0 Quick Wins)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 降低外部 AI Agent 的首次接入门槛 —— 4 个聚焦的内容补充 + 1 个 description 字段精简，让 agent 在不读完整 1611 行的情况下完成 onboarding。

**Architecture:** 纯文档增量改动。所有变更向后兼容（additive + 1 个 description 精简）。主 SKILL.md 仍是单一文件，不拆 references/。无新文件，无新依赖，无代码改动。

**Tech Stack:** Markdown + YAML frontmatter. 触发 `pnpm conformance:check` 与 `pnpm capabilities:check` 验证零漂移。

**Design rationale:** 本计划只做 P0（最高 ROI）。Phase 2（P1：拆 references/、PowerShell 示例）与 Phase 3（P2：plugin manifest、OpenAPI 自动生成）作为 deferred 阶段列出，不在本次执行范围。

---

## File Structure

### Modified files (1)
| 文件 | 改动 | 位置 |
|------|------|------|
| `docs/superpowers/skill.md` | +4 章节（Quick Start / Token Budget / Error Cheat Sheet / 4 段例） | 行 9 后、行 13 前；行 80 后 |
| `docs/superpowers/skill.md` | description 精简 | 行 3 |

### New files (0)

### Untouched
- `src/main/**` — 无代码改动
- `openapi.json` — 无 schema 改动
- `tests/**` — 无测试改动（Phase 1 是纯文档）
- `package.json` — 无依赖改动

---

## Task 1：在文档顶部插入 `## 🚀 Quick Start (5 分钟接入)` 章节

**Files:**
- Modify: `docs/superpowers/skill.md:9`（在 `无桌面客户端。` 行之后、`---` 行之前插入）

- [ ] **Step 1.1：确认插入点**

Read `docs/superpowers/skill.md` lines 5-13。确认结构为：
```
6: # 🎯 Hunter Platform — Agent Skill (v1)
7:
8: > 任何外部 AI Agent 通过本文档即可对接 Hunter Platform。
9: > 三角色（**候选人 / 猎头 / 雇主**）共享同一套 HTTP API，纯 API-only 模式，无桌面客户端。
10:
11: ---
12:
13: ## 📝 最近升级（按时间倒序）
```

- [ ] **Step 1.2：插入 Quick Start 章节**

在第 11 行的 `---` 之前插入以下内容：

```markdown

## 🚀 Quick Start (5 分钟接入)

> 读完这一节你就能调用 Hunter Platform。细节查 §X-X。

### Step 1：注册账号（立即保存 api_key）

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"user_type":"candidate","name":"张三","contact":"z@x.com"}'
```

**响应**（`api_key` 只返回这一次，立即保存到密钥管理器）：

```json
{
  "ok": true,
  "data": {
    "user_id": "u_abc123",
    "api_key": "hp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

### Step 2：调用第一个能力

```bash
curl http://localhost:3000/v1/users/u_abc123/status \
  -H "Authorization: Bearer hp_live_xxx..."
```

### Step 3：自助排查（一秒判断）

| 症状 | 一秒判断 |
|------|----------|
| 401 | Authorization header 缺失或 key 拼错 |
| 400 INVALID_CHARSET | 中文 payload 用 Python/Node 序列化（见 §4.3） |
| 409 INVALID_STATE | 调 `GET /v1/users/{id}/status` 看当前状态机 |
| 429 RATE_LIMITED | 严格 sleep `Retry-After` 秒，不要立即重试 |
| 不知道能调什么 | `GET /v1/capabilities/me` 列你的能力清单 |

### Step 4：退出策略

- **业务逻辑问号** → 读 §0（业务模型）+ §3（状态机）
- **endpoint 拼写** → 读 §2（API 端点清单）
- **决策启发** → 读 §14（Agent 决策手册，本项目独有）
- **完全不熟** → 读 §15（browseTalent 详解，端到端示例）

---
```

- [ ] **Step 1.3：行数与字符增量核对**

Run:
```bash
cd /d/dev/hunter-platform
wc -l docs/superpowers/skill.md
grep -c "^## " docs/superpowers/skill.md
```

Expected: 行数从 1611 增至约 1665（+54 行），`^## ` 计数从 22 增至 23（新增 `## 🚀 Quick Start`）。

- [ ] **Step 1.4：跑 conformance 守门**

Run:
```bash
cd /d/dev/hunter-platform
pnpm conformance:check && pnpm capabilities:check
```

Expected: Both clean. skill.md 是 docs 输出，schema 改动为 0，所以两个 check 都应该 0 错误。

- [ ] **Step 1.5：Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add Quick Start section (5-min onboarding) for external agents"
```

---

## Task 2：在 Quick Start 之后插入 `## 📊 Token 预算` 章节

**Files:**
- Modify: `docs/superpowers/skill.md`（紧接 Task 1 插入的 Quick Start 之后的 `---` 之前）

- [ ] **Step 2.1：定位插入点**

`grep -n "^## " docs/superpowers/skill.md` 应该返回：
```
6: ## 🎯 Hunter Platform — Agent Skill (v1)
12: ## 🚀 Quick Start (5 分钟接入)         # Task 1 插入
66: ## 📊 Token 预算                        # 本任务插入
67: ## 📝 最近升级（按时间倒序）             # 原 line 13
```

插入位置：第 65 行（Task 1 末尾的 `---`）之前。

- [ ] **Step 2.2：插入 Token 预算章节**

```markdown

## 📊 Token 预算

> 帮 Agent runtime 决策"要不要完整加载"。

| 模式 | 加载量 | 适用场景 |
|------|--------|----------|
| **Minimal** | ~3k tokens | 只读 Quick Start + §14 决策手册 |
| **Standard** | ~8k tokens | 加 §2 endpoint 清单 + §3 状态机 |
| **Full** | ~25k tokens | 完整加载（推荐；外存/缓存友好） |

**建议**：
1. 首次会话用 Standard 模式（已覆盖 80% 决策）
2. 遇到 endpoint 签名疑问切 Full 模式查 §2
3. 状态机转换异常时只读 §3 即可

实际 token 数随 runtime tokenizer 而异（本估算按 80KB 文件 / 3.2 字符/token）。

---
```

- [ ] **Step 2.3：跑守门**

Run:
```bash
cd /d/dev/hunter-platform
pnpm conformance:check && pnpm capabilities:check
```

Expected: Clean.

- [ ] **Step 2.4：Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add Token Budget section to help agent runtime load decisions"
```

---

## Task 3：精简 description 字段（241 词 → ~120 词）

**Files:**
- Modify: `docs/superpowers/skill.md:3`

- [ ] **Step 3.1：读取当前 description**

Read `docs/superpowers/skill.md` line 3。当前内容（241 词）：

```
Use this skill when the user asks about job search, hiring, headhunters,
candidates, recruitment, or talent matching. Connects to the Hunter Platform
API for three personas: candidates (find opportunities, approve/reject unlock
requests, export or delete their data), headhunters (upload anonymized
candidates, recommend to jobs, withdraw, publish to public pool), and
employers (post jobs, browse public talent, express interest, unlock contact,
mark placements). Provides 46 REST endpoints with API key authentication
(Bearer hp_live_xxx). Includes self-discovery via /v1/capabilities and
OpenAPI spec at /v1/openapi.json. State machine for recommendations:
pending → employer_interested → candidate_approved → unlocked → placed.
```

- [ ] **Step 3.2：替换为精简版（~120 词）**

替换为：

```
Use this skill when the user asks about job search, hiring, headhunters,
candidates, recruitment, or talent matching via the Hunter Platform REST API.
46 endpoints across 3 personas (candidate/headhunter/employer), Bearer
hp_live_xxx auth, state-machine unlock flow (pending → employer_interested
→ candidate_approved → unlocked → placed), self-discovery via
/v1/capabilities and OpenAPI at /v1/openapi.json.
```

**字数核对**：`echo "<new desc>" | wc -w` 应返回约 60-70 词（含 markdown 噪声约 120 tokens）。

- [ ] **Step 3.3：验证触发语义仍覆盖**

跑一个最小触发测试（手动判断，不需要脚本）：

| 用户 query（示例） | 应触发 skill |
|------|------|
| "帮我找一个猎头" | ✅（headhunters 命中） |
| "我想换工作" | ✅（job search 命中） |
| "招聘 Python 工程师" | ✅（hiring / candidates 命中） |
| "查看我的简历" | ✅（talent matching 命中） |
| "今天天气" | ❌（不命中） |

- [ ] **Step 3.4：跑守门**

Run:
```bash
cd /d/dev/hunter-platform
pnpm conformance:check && pnpm capabilities:check
```

Expected: Clean（description 改动不影响 schema 检查）。

- [ ] **Step 3.5：Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): trim description to ~120 words for faster agent trigger matching"
```

---

## Task 4：在 Token 预算之后插入 `## 🆘 Common Errors at a Glance` 章节（深化版）

**Files:**
- Modify: `docs/superpowers/skill.md`（紧接 Task 2 之后）

> 注：Task 1 的 Quick Start 已含"秒判断"小表；Task 4 是更详细的版本（10 个错误，含 http_status + code + 排查步骤）。两者互补：Quick Start 是 "triage"，Task 4 是 "diagnose"。

- [ ] **Step 4.1：定位插入点**

`grep -n "^## " docs/superpowers/skill.md` 应返回 24 个章节。插入位置：在 `## 📊 Token 预算` 之后的 `---` 之前。

- [ ] **Step 4.2：插入 Common Errors 章节**

```markdown

## 🆘 Common Errors at a Glance

> 出错时按 http_status 排序查这一节。每行格式：`HTTP / code / 触发场景 / 排查动作`。

| HTTP | code | 何时触发 | 排查动作 |
|------|------|---------|---------|
| 400 | `INVALID_BODY` | JSON 解析失败 | 用 `--data-binary @-` 替代 `-d`，避免 shell 转义 |
| 400 | `INVALID_CHARSET` | GBK 编码中文 payload | 改用 Python `json.dumps(..., ensure_ascii=False)` + `--data-binary @-`；见 §4.3 |
| 400 | `MISSING_FIELD` | 必填字段缺失 | 对照 §2 表的 required 列；注意 `candidate.upload` 需要 `current_company`（v1.8 起必填） |
| 401 | `INVALID_API_KEY` | Bearer 缺失 / 拼错 / 已 rotate | 检查 `hp_live_` 前缀；rotate 后旧 key **立即**失效，无 grace |
| 403 | `INSUFFICIENT_QUOTA` | 当日配额用尽 | 看响应 `X-Quota-Used` / `X-Quota-Limit` 头；admin 角色不受限 |
| 404 | `NOT_FOUND` | 资源 ID 不存在或不属于你 | 调 `GET /v1/users/{id}/status` 确认存在；猎头看不到其他猎头的简历 |
| 409 | `INVALID_STATE` | 状态机跳步 | 调 `GET /v1/users/{id}/status` 看当前状态；按 §3 状态图走合法迁移 |
| 409 | `DUPLICATE_REQUEST` | 同 (候选人, job) 已推荐 | 检查是否已发过 `POST /v1/headhunter/recommendations`；不需要重试 |
| 429 | `RATE_LIMITED` | IP / 用户级限流 | **严格** sleep `Retry-After` 头整数秒；不要立即重试；admin 不受限 |
| 5xx | `INTERNAL_ERROR` | 服务端故障 | 拿响应 `x-trace-id` header；查 `action_history.trace_id`；联系支持时附 ID |

**重要**：所有 5xx 都自动带 `x-trace-id: <32-hex>` header（v1.7 起）。回报问题时附这个 ID。

---
```

- [ ] **Step 4.3：交叉引用 §3 与 §4.3**

Read `docs/superpowers/skill.md` 找到 §3（状态机）与 §4.3（GBK）章节。确认：

- §3 行号：`grep -n "^## .*状态机" docs/superpowers/skill.md`
- §4.3 行号：`grep -n "^### 4\.3" docs/superpowers/skill.md`

如果链接引用错误，按以下方式修正 Task 4.2 插入的章节：
- "见 §4.3" → "见 §4.3 编码陷阱（行 NNN）"

- [ ] **Step 4.4：跑守门**

Run:
```bash
cd /d/dev/hunter-platform
pnpm conformance:check && pnpm capabilities:check
```

Expected: Clean.

- [ ] **Step 4.5：Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): add Common Errors at a Glance (10 errors, status-sorted)"
```

---

## Task 5：最终验证

**Files:** None modified.

- [ ] **Step 5.1：跑全套 CI 守门**

Run:
```bash
cd /d/dev/hunter-platform
pnpm typecheck && \
pnpm conformance:check && \
pnpm capabilities:check && \
pnpm openapi:check && \
pnpm schema-coverage 2>&1 | tail -20
```

Expected: All clean. 0 typecheck errors. 46/46 conformance. 64 endpoints in openapi.

- [ ] **Step 5.2：本地起服务，curl 验证 /v1/skill.md**

Run:
```bash
cd /d/dev/hunter-platform
pnpm dev > /tmp/dev.log 2>&1 &
sleep 8
curl -s http://localhost:3000/v1/skill.md | grep -E "^## " | head -10
kill %1
```

Expected: 输出包含 `## 🚀 Quick Start`、`## 📊 Token 预算`、`## 🆘 Common Errors` 三个新章节。

- [ ] **Step 5.3：手动 smoke test 触发 description**

在 Claude Code / Codex / 任意支持 SKILL.md 触发的 runtime 里，输入：
> "我想找一个 Python 后端工程师的职位"

Expected: 该 runtime 自动加载 hunter-platform skill（description 含 "job search / hiring / candidates"）。

- [ ] **Step 5.4：行数与 git diff 核查**

Run:
```bash
cd /d/dev/hunter-platform
wc -l docs/superplatform/skill.md  # 应约 1755 行（原 1611 + ~144 增量）
git log --oneline e7f8bd8..HEAD    # 应有 4 个新 commit
git diff e7f8bd8..HEAD --stat | tail -3
```

Expected: 4 commits, single file modified (`docs/superpowers/skill.md`), +~144/-~5 lines.

---

## Self-Review Checklist

- [ ] Task 1 的 Quick Start 在第 12 行（紧接 Title 后），不在错误位置
- [ ] Task 2 的 Token 预算与 Task 1 顺序正确（Quick Start 在前，预算在后）
- [ ] Task 3 的 description 是**精简**而非删除（仍含 personas、auth、state machine 关键词）
- [ ] Task 4 的 10 个错误码与 §4.2 一致（无新增错误码，仅重新组织）
- [ ] Task 4 中 `current_company` 必填的注解匹配 v1.8 实施（commit `8fb36bc docs(skill): mark current_company as required on candidate upload`）
- [ ] Task 5.1 守门全过
- [ ] description 精简后不影响 Anthropic Skills 兼容性（保留 `name` + `description` 两必填字段）
- [ ] 无 "TBD" / "TODO" / "implement later" 占位符
- [ ] 4 个 commit 都用 `docs(skill):` 前缀（与项目惯例一致）

## Definition of Done

1. `docs/superpowers/skill.md` 含 3 个新章节（Quick Start / Token Budget / Common Errors）
2. description 字段精简到 ≤ 130 词（保留所有触发关键词）
3. `pnpm conformance:check` 通过
4. `pnpm capabilities:check` 通过
5. `pnpm typecheck` 通过
6. `GET /v1/skill.md` 返回新内容
7. 4 个原子 commit（Task 1/2/3/4 各一）+ 1 个 verification commit（可选合并到 Task 4）

## Out of Scope (deferred to Phase 2/3/4)

下列改进属于后续阶段，**本计划不实施**：

### Phase 2 — P1（中等投入，下个 sprint）
- **拆 references/ 子目录** 做渐进式披露：主 SKILL.md 精简到 ~300 行，详细章节移到 `references/*.md`
- **PowerShell / CMD / Git Bash 编码示例**（§4.3 扩展）：当前只有 Python / Node / cURL 三种，缺 Windows 原生 PowerShell
- **§14 决策手册强化**：补充 3 个反模式案例（从真实 agent 集成 bug 抽取）

### Phase 3 — P1/P2（季度级）
- **加 `.claude-plugin/plugin.json` + `marketplace.json`**：让 Claude Code / Codex / OpenCode 一行命令安装
- **§2 endpoint 表由 OpenAPI 自动生成**：消除 "skill.md endpoint count 58→64" 这类手维护漂移（commit `cf091e8` 历史教训）
- **`## 🤖 Agent Changelog` 章节**：面向 agent 的版本变更说明（区分人类 release notes）

### Phase 4 — P2（backlog）
- **拆分为多 skill**：hunter-platform-core / candidate / headhunter / employer / admin / webhook 6 个子 skill
- **运行时 capability 推送**：agent 启动时只拉取自己角色的 skill

## Effort Estimate

~2-3 小时。5 个 commit。Phase 1 总计变更约 +144 行（不含 frontmatter 改动）。

风险：
- **低**：纯文档改动，无代码路径
- **低**：CI 守门已存在（conformance / capabilities / openapi:check）
- **中**：description 精简可能影响某些 runtime 的触发（建议 Phase 1 完成后观察一周 agent 上线数据）

## 相关文件

- `docs/superpowers/skill.md` — 主目标
- `scripts/check-conformance-coverage.ts` — `pnpm conformance:check` 实现
- `scripts/check-capabilities.ts` — `pnpm capabilities:check` 实现
- `docs/superpowers/specs/2026-06-22-action-type-to-capability-name.md` — 类似 commit 风格的最近 spec 范例（仅参考格式）