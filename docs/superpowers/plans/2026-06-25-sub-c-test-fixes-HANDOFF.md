# Sub-C Test Fixes Handoff

## 任务背景

Sub-C（spec + Plan 1 + Plan 2）已在 main 上提交完毕，34 commits 全部 green。但**有 4 个旧测试未跟随 schema/handler 变更同步更新，导致现在失败**。这 4 个失败是 Sub-C 引入的（breaking change 未连带更新测试），不是 pre-existing。

本次任务：更新 4 个测试，让 `npx vitest run` 全绿。

---

## 范围（4 个测试，3 个文件）

### 1. `tests/unit/admin-schemas.test.ts` — 2 个 case

**Case A: `describe('DashboardStatsResponseSchema') > it('accepts a stats payload')`** (line 20-32)

Schema 加了 7 个字段（Plan 1），但测试 payload 还停留在原始 9 字段。

**修改：** 在现有 payload 的 `trend_30d: Array(30).fill(0)` 后追加 7 个字段：

```typescript
        today_new_recommendations: 5,
        recommendations_pending: 3,
        recommendations_unlocked: 2,
        jobs_paused: 1,
        jobs_closed: 1,
        jobs_filled: 1,
        total_recommendations: 10,
```

完整修改后的 case：

```typescript
describe('DashboardStatsResponseSchema', () => {
  it('accepts a stats payload', () => {
    const r = DashboardStatsResponseSchema.safeParse({
      ok: true,
      data: {
        total_users: 10, total_candidates: 5, total_jobs: 3, open_jobs: 2,
        active_placements: 1, daily_quota_used: 100, webhook_dead_letters: 0,
        today_new_users: 2, trend_30d: Array(30).fill(0),
        // Sub-C Plan 1 additions
        today_new_recommendations: 5,
        recommendations_pending: 3,
        recommendations_unlocked: 2,
        jobs_paused: 1,
        jobs_closed: 1,
        jobs_filled: 1,
        total_recommendations: 10,
      },
    });
    expect(r.success).toBe(true);
  });
});
```

**Case B: `describe('AdjustQuotaResponseSchema') > it('accepts an adjusted result')`** (line 54-62)

Schema 加了 `previous_quota` + `reason`（Plan 2），但测试 payload 还没更新。

**修改：** 把 `{ user_id: 'u1', new_quota: 200 }` 改为：

```typescript
        data: { user_id: 'u1', previous_quota: 100, new_quota: 200, reason: 'test' },
```

---

### 2. `tests/integration/admin-endpoints.test.ts` — 1 个 case

**Case: `POST /v1/admin/users/:id/adjust-quota accepts valid value`** (line 178 附近)

旧测试发送 `{ new_quota: 50 }`（无 reason）。Plan 2 后 reason 必填（≥3 字符），所以现在返回 400。

**修改：** 在 `.send({ new_quota: 50 })` 后加 reason：

```typescript
        .send({ new_quota: 50, reason: 'integration test adjustment' });
```

定位：grep "adjust-quota" 找具体行号，case 应该叫 `accepts valid value`。

---

### 3. `tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts` — 1 个 case

**Case: `admin.adjust_user_quota: POST /v1/admin/users/:id/adjust-quota`** (line 210 附近)

同 #2 — 测试调用 endpoint 但未传 reason。

**修改：** 在测试调用处加 reason 字段。定位：grep `adjust_user_quota` 找到对应 `expect(r.status).toBe(200)` 那段，在请求 body 加 `reason: '...'`。

---

## 执行步骤（每个文件）

按 TDD 标准流程（与 Sub-C Plan 一致）：

1. 读当前测试文件 → 确认 case 位置
2. **改测试代码**（按上面 patch）
3. **跑测试** → 应该通过
   - `npx vitest run tests/unit/admin-schemas.test.ts` （针对文件 1）
   - `npx vitest run tests/integration/admin-endpoints.test.ts` （针对文件 2）
   - `npx vitest run tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts` （针对文件 3）
4. **Commit**（每个文件单独 commit，message 如下）

---

## Commit 节奏（3 个 commit）

```bash
git add tests/unit/admin-schemas.test.ts
git commit -m "test(admin-schemas): update unit tests for Sub-C schema changes (DashboardStats +7 fields, AdjustQuota +previous_quota/reason)"

git add tests/integration/admin-endpoints.test.ts
git commit -m "test(admin-endpoints): adjust-quota integration test — add required reason field"

git add tests/integration/skill-md-conformance/schema-shape-admin-precondition.test.ts
git commit -m "test(skill-md-conformance): admin.adjust_user_quota precondition test — add required reason field"
```

---

## 完成后必做

跑全套验证：

```bash
npx vitest run 2>&1 | tail -8
```

**期望：** 0 failed（除可能仍 flaky 的 UTC 时区测试 #9 — 那是 Sub-B 留下的，与本次无关）。

如仍有失败，按错误排查，**不要**继续往后推。

---

## 不要做

- ❌ 不要改 schema（schema 是 Sub-C 正确结果）
- ❌ 不要改 handler（handler 是 Sub-C 正确结果）
- ❌ 不要改 production 代码任何一行（本次纯测试同步）
- ❌ 不要新增测试（这次只更新旧测试）
- ❌ 不要"修"那个 flaky UTC 测试（Sub-B 留下，本次不在范围）
- ❌ 不要重跑全部 test 文件发现其他"潜在问题"——只关注这 4 个

---

## 已知 flaky 测试（如出现，忽略）

`tests/integration/admin-list-pagination.test.ts` > `9. dashboard today_new_users counts only today (UTC)` — 这是 Sub-B 留下的 UTC 时区边界 flaky 测试，Sub-C 没动它。如出现"间歇性通过/失败"，属正常。

---

## 预期产出

- 3 个 commit（每个文件一个）
- `npx vitest run` → 0 failed（最多剩 1 个 flaky UTC 测试）
- 没有 production 代码改动

预计 30-45 分钟工作量。