# Post-Phase 3 Code Review

> **Reviewer:** 主 AI
> **Date:** 2026-06-22
> **Scope:** 12 commits (Phase 3: Flow 状态机)
> **Test baseline:** 622/622 PASS
> **Review type:** Post-implementation audit (correctness, security, design)

---

## 总体评分: **C+**

**核心结论**:
- Flow 抽象本身设计合理 (types.ts / applyTransition),测试覆盖好
- 状态机的**合法转移表**完全正确 (无 regression on transition rules)
- 但 **side effects 完全没被使用** — `result.sideEffect` 在所有 handler 里都被忽略,webhook 还是硬编码 inline
- 这意味着 Phase 3 声称的"side effects 集中到 Flow"是个**空头支票**
- 加上 1 个 behavior regression (admin/unsuspend 对已 active 用户从 no-op 变成 500)

---

## 关键发现（按严重度排序）

### CRITICAL

- [ ] **C1. [Design Defect] 所有 handler 都忽略 `result.sideEffect` — Flow 的 side effects 是死代码**
  - 文件: `src/main/modules/candidate/handler.ts:99-121`, `employer/handler.ts:170-197, 226-285`, `admin/handlers/users.ts:24-36`
  - 现状: `applyTransition` 返回 `{ next, sideEffect }`,但 4 个 handler 一个都不读 `sideEffect`。`grep "result.sideEffect" src/main/modules/` 零结果。
  - 验证:
    - `candidate/handler.ts:115-121`:`webhooks.enqueue` 完全 inline,没用 `result.sideEffect`
    - `employer/handler.ts:191-197`:同上
    - `employer/handler.ts:264-270` (unlockContact):同上
    - `admin/handlers/users.ts:24-27`:完全没调 admin_action_log,即使 userFlow 的 sideEffect 是 `admin_action_log` 类型
  - 风险: Phase 3 计划的目标是"把 side effects 集中到 Flow 声明里,handler 不会忘记更新 status 或漏发 webhook"。**实际上 side effects 仍然在 handler 里 inline**,只是多加了一个 dead 声明。抽象没达到目的。
  - **建议**:
    - **方案 A (推荐)**: Handler 真的读 `result.sideEffect`,根据 `kind` 派发
    - **方案 B (退而求其次)**: 把 userFlow / recFlow 的 `sideEffects` 全删掉,承认抽象是"只管合法转移,不管副作用"
  - **强烈建议方案 A** — 不然 Phase 3 就是 refactor 而已,没达到目的

### HIGH

- [ ] **H1. [Behavior Regression] `admin/unsuspend` 对已 active 用户从 no-op 变成 500**
  - 文件: `src/main/modules/admin/handlers/users.ts:29-37`
  - 现状: `unsuspend` 不 try/catch `applyTransition` 抛的 `TransitionError`。如果用户已经是 active,flow 抛 `Invalid state transition: cannot 'unsuspend' from 'active'` → 500
  - 重现:
    1. Admin 调 `POST /v1/admin/users/:id/unsuspend` 对一个 active 用户
    2. Phase 3 之前: 200 (UPDATE 设 status='active',no-op)
    3. Phase 3 之后: 500 (TransitionError 没人 catch)
  - 同样 `suspend` 对已 suspended 用户也会 500
  - **建议**: 加 try/catch 转换到 `Errors.invalidState('User is already <status>')`,或者在 service 层做幂等检查
  - **业务影响**: admin 重复点 unsuspend 按钮会让 UI 显示 500,虽然不致命但是 regression

- [ ] **H2. [Dead Code] `employer/claimJob` 的 `applyTransition` 是 unreachable**
  - 文件: `src/main/modules/employer/handler.ts:325`
  - 现状:
    ```typescript
    if (job.status !== 'open') throw Errors.invalidState(...);  // line 315
    // ...
    applyTransition(jobFlow, job.status, 'claim', {});  // line 325 — UNREACHABLE
    const claimed = jobs.claimByEmployer(...);
    ```
  - 三个层次检查,line 325 没有防御价值
  - **建议**: 删除 line 322-325

- [ ] **H3. [Design Inconsistency] `defineFlow` 是 identity function**
  - 文件: `src/main/flows/types.ts:39-43`
  - 现状: `defineFlow` 啥也不做,就是 `return spec`
  - **建议**: 要么删了直接用 object literal + `as const`,要么真的加点东西

### MEDIUM

- [ ] **M1. [Inconsistent Error Handling] handler 对 TransitionError 处理不一致**
  - 应该有统一的 helper,而不是每个 handler 自己 try/catch

- [ ] **M2. [Test Gap] Flow test 不覆盖 `applyTransition` 与 handler 的集成**
  - 单元测试只测了 "transition is valid / invalid" 和 "side effect function returns X"
  - 没有测"handler 调用 applyTransition 后,result.next 真的等于预期,sideEffect 真的派发了"
  - 这是 C1 死代码 root cause — 没测就没人发现
  - **建议**: 加集成测试,例如:`test_approve_unlock_calls_webhook_with_right_args`

- [ ] **M3. [Documentation Drift] `userFlow.sideEffects` 的 JSDoc 与实现不符**
  - 文件: `src/main/flows/user.ts:11-20`
  - JSDoc: "Both 'suspend' and 'delete' transitions write an admin_action_log row"
  - 实际: handler 不读 sideEffect,admin_action_log 永远不写
  - **建议**: 跟 C1 一起修

- [ ] **M4. [Coverage Gap] `unsuspend` 对已 active 用户的回归测试没有**
  - 见 H1。这是 behavior regression,应该有 regression test

### LOW

- [ ] **L1. [NITPICK]** Phase 3 没碰的不相关问题
- [ ] **L2. [NITPICK] shim 阶段 commit `08f3938` 的 message 没说明 shim 范围**

---

## 各 review 维度详细结论

### A. 正确性: **OK (1 MEDIUM)**
- ✅ recFlow 状态表与原 modules/unlock/state-machine.ts 完全一致
- ✅ jobFlow 5 状态,转移规则合理
- ✅ userFlow 3 状态,GDPR 流程正确
- ⚠️ H1: admin/unsuspend 对已 active 用户的 behavior regression

### B. 安全性: **OK**
- 无新 attack surface
- 转移表 + 副作用 的声明式描述不会泄露 PII

### C. 行为保持: **2 问题 (1 HIGH + 1 MEDIUM)**
- ⚠️ H1: admin/unsuspend 在某些情况下从 200 变成 500
- ⚠️ C1: sideEffect 完全没被 dispatch,webhook 仍 inline — 抽象没达成设计目的

### D. 测试覆盖: **MEDIUM (新增 22 个单测,无集成测)**
- ✅ 622 tests pass
- ✅ 4 个 flow 文件都有单元测试
- ⚠️ M2: 没有 handler ↔ flow 集成测试
- ⚠️ M4: admin/unsuspend regression 无 test

### E. 代码风格: **OK**
- 22/22 commit 无 @ts-ignore
- H3 除外 (defineFlow 是 no-op)

### F. 文档/配置漂移: **MEDIUM**
- ⚠️ M3: user.ts JSDoc 撒谎

### G. 设计/可维护性: **1 HIGH + 2 MEDIUM**
- ⚠️ C1: 抽象目的未达成
- ⚠️ H2: claimJob 有 dead code
- ⚠️ H3: defineFlow 是 no-op
- ⚠️ M1: error handling 不一致

---

## 建议优先处理（Top 3）

1. **修 C1** (handler 真的 dispatch `result.sideEffect`) — 不然 Phase 3 是空 refactor。建议方案 A。
2. **修 H1** (admin/unsuspend 错误处理) — 1 个 if/throw 改动,加 regression test
3. **修 H2** (删 claimJob 里的 dead `applyTransition` 调用) — 3 行删除

---

## 关键问题诊断

### 计划 vs 实际 — 最大的设计缺陷

**计划声称**:
> 每个 flow 声明 `sideEffects['from->to']` — 转移时触发的副作用 (webhook / audit log)
> Handler 通过 `applyTransition(flow, from, event, ctx)` 触发转移,返回 `{ next, sideEffect }`
> 返回后 handler 自己负责: 写 DB 状态 + 派发 sideEffect (enqueue webhook 等)
> 这样 state machine 是一处声明,handler 不会忘记更新 status 或漏发 webhook

**实际代码** (candidate/handler.ts:99-121):
```typescript
let result;
try {
  result = applyTransition(recFlow, rec.status, 'approve_unlock', { employer_id: rec.employer_id });
} catch (e) {
  throw Errors.invalidState(...);
}
recs.updateStatus(rec.id, result.next);
audit.insert({...});
webhooks.enqueue({  // ← sideEffect 完全没用,这里还是 hardcoded
  target_user_id: rec.employer_id,
  event_type: 'notify_unlock_approved',
  ...
});
```

**症状**: `REC_SIDE_EFFECTS['employer_interested->candidate_approved']` 这个函数定义了,测试通过了 (因为 unit test 单独调用它),**但 production code path 永远不调用**。

**这是 plan gap,不是执行 gap**。计划在 Task 6 写"`webhooks.enqueue({...}, result.sideEffect...)` 风格" 但 Step 2.2 / 2.3 的实际代码示例直接复用了旧 webhook block,没说明怎么 merge。

---

## 验证命令

```bash
cd /d/dev/hunter-platform && pnpm test
cd /d/dev/hunter-platform && pnpm test flows
cd /d/dev/hunter-platform && pnpm typecheck
cd /d/dev/hunter-platform && pnpm openapi:check
```

---

## 修复优先级建议

修完 Top 3 (估计 30-60 分钟工作),Phase 3 就可以 merge:

1. **C1**: 重写 4 个 handler 的 webhook enqueue 段,真的读 `result.sideEffect`
2. **H1**: admin/handlers/users.ts 加 try/catch + 加 regression test
3. **H2**: employer/handler.ts:322-325 删 4 行 dead code
