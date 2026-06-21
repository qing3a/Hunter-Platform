# Post-Phase 1 Code Review

> **Reviewer:** ZCode
> **Date:** 2026-06-21
> **Scope:** 19 commits (Phase 0: 8 bug fixes + 1 regression test, Phase 1: 11 structured-output tasks)
> **Test baseline:** 588/588 PASS
> **Review type:** Post-implementation audit (correctness, security, maintainability)

---

## 总体评分: **B**

**核心结论**:
- 7 个 bug fix 都正确,SQL 迁移兼容,回归测试覆盖充分 — **功能层面正确**。
- Phase 1 的 `respond()` helper 设计良好,schema-coverage 测试抓得住未来的回归。
- 但有 **2 个 CRITICAL/HIGH 问题**: 一处遗留的安全相关死代码会让 rotate-key 在某些场景下失效; 一处 docdrift 在告诉用户 24h grace (已不存在); `makeStrict()` 对 union 不会递归,严格模式实际只在部分 schema 生效。
- 整体可上线,但需要修这些再上线,否则会在生产埋 1-2 个真实问题。

---

## 关键发现（按严重度排序）

### CRITICAL

- [ ] **C1. [Security] auth middleware 的 `prev_api_key_*` 分支是死代码,但有人未来若改回 grace 就会复活**。
  - 文件: `src/main/modules/auth/middleware.ts:24, 35-36`
  - 现状: `CANDIDATE_SELECT` SQL 里 `(prev_api_key_prefix = ? AND prev_api_key_expires_at > datetime('now'))` 这个分支没死 (在 NULL 时 `NULL = ?` 是 falsy),但 `tryVerify` 里检查 `u.prev_api_key_prefix === prefix && u.prev_api_key_hash && verifyApiKey(...)`。Bug 1 修复后 `rotateApiKey` 永远把 `prev_api_key_*` 设成 NULL,分支永远不匹配 — 是 dead code。
  - 风险: 任何人(包括我自己)看到注释"grace slot"后可能觉得"哦那我再启用吧",但 schema-coverage test 不会拦截,**安全策略会无声地滑回旧版**,rotate-key 立即失效的保证就没了。
  - **建议**: 直接删掉 auth middleware 里的 prev 分支 (`CANDIDATE_SELECT` 和 `tryVerify` 的 prev 检查),把 `prev_api_key_*` 列保留(向后兼容),但代码上不再读。这样未来若改回 grace 也必须显式改 auth middleware,而不是改 rotate 就能激活 grace。

### HIGH

- [ ] **H1. [DocDrift] skill.md 4 处描述 rotate-key 仍说"24h grace"**,跟 Bug 1 修复直接冲突。
  - 文件: `docs/superpowers/skill.md:73, 95, 692, 1066`
  - 现状: skill.md 仍然写:
    - L73: `POST /v1/auth/rotate_key` (下划线 typo)
    - L95: `旧 key 24h 内仍可用`
    - L692: `rotate_key` (下划线 typo)
    - L1066: `旧 key 24h grace`
  - 影响: 外部 Agent (skill.md 是对接文档) 会以为 rotate 后老 key 24h 内仍有效,可能因此编写依赖老 key 长有效期的轮换逻辑,实际上老 key 立刻失效。
  - **建议**: 立刻改 4 处 typo + 移除"24h grace"描述。

- [ ] **H2. [Phase 1] `makeStrict()` 不递归进 `ZodUnion` / `ZodDiscriminatedUnion`**,严格模式只在叶子 object 生效。
  - 文件: `src/main/responses.ts:15-28`
  - 现状: `makeStrict` 只处理 `ZodObject` 和 `ZodArray`;遇到 `ZodUnion` (admin.ts 中 `z.union([z.literal(0), z.literal(1)])` 是 literal union,没 object,所以没事,但 candidates_private 的 `z.union([self, thirdParty])` 在 strict mode 下两个 object 都不会被 strictify),`ZodEffects` (ISODateTime 的 `.refine()`) 直接 return as-is — 这两类如果作为 object 嵌套会出现"外层 strict,内层不 strict"的洞。
  - 当前 schema 里: candidate.ts 已经把 `candidates_private` 简化成 `z.array(z.unknown())`,所以没有 union 暴露问题;但任何未来的 schema 用了 union + strict 就会失效。
  - **建议**: 在 `makeStrict` 里加 `if (schema instanceof z.ZodUnion) return z.union(schema.options.map(makeStrict))` 和 `if (schema instanceof z.ZodDiscriminatedUnion) return z.discriminatedUnion(...)`;`ZodEffects` 因为是 refine,可以直接返回 (没有 unknown key 概念)。

- [ ] **H3. [Phase 1] schema-coverage test 用 regex `res\.json\(\s*\{\s*ok:\s*true/g` 检查**,容易被 false-pass。
  - 文件: `tests/unit/schema-coverage.test.ts:24`
  - 现状: regex 不区分 `res.json(` 在字符串字面量里(模板字符串里有 `res.json({...}` 也会匹配)。
  - 影响: 如果未来某个 route 模板字符串里写了文档 `"res.json({ok:true,...})"`,test 不会失败。
  - **建议**: 加 `\b` 边界或更严格匹配,例如 `/^\s*res\.json\(\s*\{\s*ok:\s*true/m`;或改成 AST 分析(ts-morph)。

### MEDIUM

- [ ] **M1. [Phase 0 Bug 4] v010 迁移在 production 上**首次执行没问题,但**回滚**没文档。
  - 文件: `src/main/db/migrations/v010_job_status_claimed.sql`
  - 现状: v010 走 rename/copy/drop/rename 模式,跟 v008/v009 一样,**回滚策略是写一个 v011 把 status 改成 'open' 并 DROP CHECK 改回**,目前项目里没有 down migration 流程。
  - 风险: 如果 v010 上线后需要回滚,需要手动写 SQL,且 DROP TABLE jobs 期间会阻塞写入 (虽然 SQLite WAL 模式缓冲,production 可能 millisecond 卡顿)。
  - **建议**: 在 docs/superpowers/specs/ 或 migrations.ts 文档化回滚步骤;或用 additive migration (不 DROP,只 ADD COLUMN 'claimed_at') 替代 DROP/RECREATE。

- [ ] **M2. [Phase 1] JobSchema 在 `schemas/headhunter.ts` 和 `schemas/employer.ts` 重复定义**,只差 `required_skills` 一个用 `SkillListSchema` 一个直接 `z.array(z.string())` — 等价但分叉。
  - 文件: `src/main/schemas/headhunter.ts:24, schemas/employer.ts:6`
  - 影响: 任何 schema 字段变更要在两处同步,容易漏。
  - **建议**: 抽到 `schemas/common.ts` 的 `JobSchema`,让 headhunter 和 employer 都 import。

- [ ] **M3. [Phase 0 Bug 1] rotate-key 修复后,auth middleware SQL 里的 `prev_api_key_*` 字段冗余,但 CANDIDATE_SELECT 仍会把它 include 进查询**。
  - 文件: `src/main/modules/auth/middleware.ts:23-24`
  - 影响: 每次 auth 查询都要 4 个参数 (prefix, prefix) 而不是只 1 个;虽然 SQLite 优化器会 ignore 永远 false 的 OR 分支,但 query planner 仍要评估。
  - **建议**: 删掉 prev_* 分支 (跟 C1 同一处修复),节省 query planner 开销。

- [ ] **M4. [Phase 1] `respond()` 的 comment 跟行为不符**。
  - 文件: `src/main/responses.ts:70-72`
  - 现状: comment 说 "safeParse failed but strict=false: fall back to permissive send with console.warn",但实际代码直接 throw。
  - 影响: 误导阅读者;如果未来有人想实现真正的 fallback,会从这里开始改。
  - **建议**: 把 comment 改成实际行为,或者真的实现 fallback (但要谨慎 — 默认 mode 抛错更安全)。

### LOW

- [ ] **L1. [Phase 1] `responses.ts:22` 用了 `as any` cast**,绕过 zod 内部类型。
  - 影响: 类型不安全;zod 版本升级可能 break。
  - **建议**: 用 `z.ZodObject<...>` 显式 type param,或者用 zod 文档推荐的 `z.object(newShape).strict() as unknown as T` 显式标注。

- [ ] **L2. [Phase 0] Bug 6 regression test 是在 5e9997b commit 单独加的**,而不是跟 Bug 6 修复一起。
  - 文件: `tests/integration/employer-claim-reject.test.ts` (5e9997b commit)
  - 影响: 历史上 commit 跟修复分开让 git bisect 难找到"修复 + 回归"的完整 snapshot,但每条 commit 都完整可运行所以 OK。
  - **建议**: 未来尽量 修复 + 测试一起提交。

- [ ] **L3. [Phase 1] `responses.ts:71` 的 `console.error` 写日志**。
  - 影响: 高频错误会刷日志;但 serve 是 throw ZodError 让错误中间件统一处理,所以这里 console.error 多余。
  - **建议**: 删除 console.error,或降级到 debug logger。

- [ ] **L4. [Phase 0] admin-endpoints.test.ts 三个新 ping test** (200, 401, 401 wrong-pw) 都正确,但**没有 test "401 with expired bearer token"** 或 "401 with malformed bearer"。
  - 建议: 补充 admin auth 中间件的负面 test。

- [ ] **L5. [Phase 1] `ISODateTime = z.string().refine(...)`** 是 ZodEffects,不会出错,但 makeStrict 处理这种 leaf 是 "return as-is",意味着如果 ISODateTime 被用作 object 的 value (如 `created_at: ISODateTime`),strict mode 不会给 `created_at` 加 .strict() (它本来就不是 object),所以 OK。**但**: 如果有人写 `z.object({ ... }).strict()` 不递归进 ISODateTime — 这其实是正确的,因为 refine 不需要 strict。
  - 这条作为 LOW 是想记录: 当前代码意外地处理对了 ZodEffects 嵌套,但没有显式 case 解释这一点。

### NITPICK

- [ ] **N1. [Phase 1] `tests/unit/responses.test.ts` 用了 `as any` 在 mock res 对象上** — 测试代码可以接受,但 vitest 有更好的 `Partial<Response>` 类型可用。

- [ ] **N2. [Phase 0] commit message 里 "(regression: Bug N)" 引用前面 commit 编号**,6 个月后这些编号会变;但 OK 因为是最近 commit。

- [ ] **N3. [Phase 1] `schema-coverage.test.ts` 没跑非 .ts 文件** (没扫 landing.ts 等 HTML route),这是好事(用 res.json 检测),但未来如果有人加 .js route,coverage 会漏。建议加扩展名扫描。

- [ ] **N4. [Phase 0] v006 API key grace period migration** 跟 Bug 1 修复相互冲突 (v006 加了 grace 机制,Bug 1 修复移除了)。考虑加 v011 migration 把 prev_api_key_* 列删掉 (但会破坏 schema 回滚兼容)。

---

## 各 review 维度详细结论

### A. 正确性: **OK (有 1 个 MEDIUM)**

- ✅ Bug 1 (rotate-key): 修复路径完整 — `rotateApiKey` SQL 写对,auth middleware 通过 NULL-safe 的 `prev_api_key_prefix = ?` 自动失效旧 key,新 rotate-key.test.ts 覆盖 happy path + 旧 key 失效。
- ✅ Bug 2 (admin/ping): `app.get('/v1/admin/ping', ...)` 已删,所有 /v1/admin/* 走 createAdminAuthMiddleware;3 个新 test 覆盖 valid/wrong/missing bearer。
- ✅ Bug 3 (PII redaction): `exportMyData` 加了 `isSelfSubmitted` 判断,third-party 行只返回 notice 对象 + fields_available,不解密 name/phone/email;`candidates_anonymized` 表本身只含 industry/title_level/years_experience/salary_range/education_tier/skills,无 PII,导出安全。
- ✅ Bug 4 (v010 migration): 走 rename/copy/drop/rename 模式,数据 1:1 复制 (status 所有值 'open'/'paused'/'closed'/'filled' 在新 CHECK 里都合法),DROP backup 在 commit 前,production 一次成功。但**回滚无文档** — MEDIUM M1。
- ✅ Bug 5 (gather-landing-data 'claimed' 状态): 6 处查询都从 `WHERE status = 'open'` 改成 `WHERE status IN ('open','claimed')`,test 已有 landing-v4 覆盖。
- ✅ Bug 6 (employer claimJob): 状态机 idempotent 返回 'claimed' 自己拥有;rejectJob 在 status != 'open' 时 409;`test 5e9997b` 覆盖 claim-then-reject 场景。
- ✅ Bug 7 (headhunter 'claimed' 推荐): `recommendCandidate` 从 `job.status !== 'open'` 改为 blacklist (`closed`/`filled`/`paused`),接受 'open' 和 'claimed'。
- ✅ v010 状态机: 三个 handler (employer/claimJob、employer/rejectJob、headhunter/recommendCandidate) 同步接受 'claimed',内部一致。

### B. 安全性: **2 个问题 (1 CRITICAL + 1 MEDIUM)**

- ⚠️ **C1 (CRITICAL)**: auth middleware 的 prev_api_key_* 分支是 dead code,但注释里有 "Grace slot" 字样,可能被未来 PR 错误激活。建议**直接删掉** prev 分支代码。
- ⚠️ **M3 (MEDIUM)**: CANDIDATE_SELECT 多一次 OR 分支评估 (虽然 SQLite planner 会忽略,但代码冗余)。
- ✅ Bug 1: 旧 key 立即失效 — `rotateApiKey` 是单 UPDATE,SQLite 自动提交 + WAL fsync;测试不 sleep 就用旧 key,确认无 race window。
- ✅ Bug 2: 没有其他未保护的 admin 端点 — grep `app.get` / `app.use('/v1/admin',` 都走 middleware;`createAdminAuthMiddleware` 用 `ADMIN_PASSWORD` bcrypt 校验。
- ✅ Bug 3: candidates_anonymized 表本身无 PII (industry/title_level 是统计型),导出 candidates_anonymized 不构成泄露。
- ⚠️ **未测试**: admin auth 中间件的负面场景 (expired token, malformed bearer) 没覆盖 — LOW L4。

### C. Phase 1 行为保持: **2 个问题 (1 HIGH + 1 MEDIUM)**

- ⚠️ **H2 (HIGH)**: `makeStrict()` 不递归进 ZodUnion / ZodDiscriminatedUnion,strict mode 只在叶子 object 生效。当前后代 schema 没暴露这个问题,但任何未来 union + strict 会失效。
- ⚠️ **M4 (MEDIUM)**: `responses.ts:70-72` comment 说"fall back to permissive send with console.warn",实际代码直接 throw。误导阅读者。
- ✅ 默认 mode (strict=false) 是 zod 默认行为 (strip unknown fields),production 行为保持 — 不产生静默数据丢失,因为 server-side strict 是 OFF,client-side zod parse 才是 strip 发生地;前端如果用了相同的 zod schema 会自动 strip,所以**前端用 zod 后**不会有 UI 错位,**前端不用 zod** 会收到 extra_field。前端目前没强制用 zod,所以这是**潜在的低严重度问题**。
- ✅ schema-coverage.test.ts:14 用 `if (!hasAnyResJson) return;` 跳过 landing.ts;landing.ts 用 `res.type('text/html').send(html)`,确实无 res.json,跳过正确。

### D. 测试覆盖: **充分 + 1 LOW**

- ✅ 588/588 测试通过。
- ✅ Bug 1 (rotate-key): 有 integration test (rotate-key.test.ts) 覆盖 happy path + 旧 key 失效。
- ✅ Bug 2 (admin/ping): 有 3 个 test (valid / no bearer / wrong pw)。
- ✅ Bug 3 (PII redaction): candidate-export.test.ts + e2e-m4.test.ts 都有 test,新增 selfSubmitted case。
- ✅ Bug 4 (v010 migration): migrations-v002/v003 测试更新,集成测试 landing-v4 / e2e-m4 覆盖 'claimed' 状态路径。
- ✅ Bug 5 (gather-landing-data): landing-v4 test 覆盖 'claimed' 显示。
- ✅ Bug 6 (employer state machine): 5e9997b 回归测试覆盖 claim-then-reject。
- ✅ Bug 7 (headhunter 'claimed'): 已被 e2e-m4 (placement) 间接覆盖。
- ⚠️ **缺失场景**: empty data 数组、超大 payload、unicode 在 schema 中没有显式边界 test。

### E. 代码风格 / 一致性: **2 个 LOW**

- ✅ Commit message 格式统一: `fix(scope):`, `feat(scope):`, `refactor(scope):`, `test(scope):`, `docs(scope):`。
- ✅ 19/19 commit 没 "@ts-ignore" / "@ts-nocheck"。
- ⚠️ **L1 (LOW)**: `responses.ts:22` 用了 `as any` — 唯一一处。
- ⚠️ **L3 (LOW)**: `responses.ts:71` 用了 `console.error` 而不是 logger。
- ⚠️ 测试代码用 `as any` mock (可接受,LOW N1)。

### F. 文档/配置漂移: **1 个 HIGH**

- ⚠️ **H1 (HIGH)**: skill.md 4 处 stale 文档:
  - L73 `rotate_key` (typo 下划线) → 应是 `rotate-key`
  - L95 `旧 key 24h 内仍可用` → 应改为 `旧 key 立即失效`
  - L692 `rotate_key` → typo
  - L1066 `旧 key 24h grace` → 应改为 `旧 key 立即失效`
- ✅ openapi.json 与 schema 是独立的 — openapi:check 0 forward gaps,且 openapi 字段(rotate-key 的 response schema)已跟 Bug 1 修复同步 (删了 old_key_expires_at)。
- ✅ .env / .env.example 不需要新增 — Bug 1 修复不需要新 env var。
- ⚠️ 建议在 skill.md 增加 "rotate-key 立即失效 vs 之前的 24h grace" 的 change log 段落,帮外部 Agent 理解行为变更。

### G. 性能/可维护性: **2 个 MEDIUM + 1 LOW**

- ⚠️ **M2 (MEDIUM)**: JobSchema 在 headhunter.ts / employer.ts 重复 — 1 行差异 (`SkillListSchema` vs `z.array(z.string())`)。建议抽到 common.ts。
- ⚠️ **M3 (MEDIUM)** (重复): CANDIDATE_SELECT 冗余 OR 分支。
- ✅ respond() 性能成本: `safeParse` 是同步纯 JS,无 IO;估算 100 req/s 时,Zod parse ~5-50μs per response,总共 ~0.5-5ms/s CPU (0.05%-0.5% of single core) — 可忽略。
- ✅ makeStrict() 只在 strict=true 时调用 (生产实际不用),性能 OK。
- ⚠️ **L1 (LOW)**: `as any` cast 一次 (responses.ts:22)。
- ✅ schemas/ 文件组织清晰,每个 domain 一个文件。

---

## 建议优先处理（Top 3）

1. **修 H1 (skill.md 4 处 stale rotate-key 文档)** — 5 分钟,external Agent 立刻受益,无 risk。
2. **修 C1 (删 auth middleware 的 prev_api_key_* dead code)** — 10 分钟,防止未来 security 倒退;同时解决 M3 query planner 冗余。
3. **修 H2 (makeStrict 递归进 ZodUnion / ZodDiscriminatedUnion)** — 30 分钟,加一个 union case + 加测试;避免未来 strict mode 实际失效的陷阱。

---

## 附录: 验证命令

```bash
# 跑全测试 (588 expected)
cd /d/dev/hunter-platform && pnpm test

# typecheck (0 errors expected)
cd /d/dev/hunter-platform && pnpm typecheck

# schema-coverage (9 tests, 0 forward gaps expected)
cd /d/dev/hunter-platform && pnpm test:schemas

# openapi check (0 forward gaps expected)
cd /d/dev/hunter-platform && pnpm openapi:check
```

## 附录: 改动行数

| 类别 | commits | 净增行 |
|---|---|---|
| Phase 0 bug fixes | 8 | ~+200 / -60 |
| Phase 1 structured output | 11 | ~+1500 / -200 |
| 合计 | 19 | ~+1700 / -260 |