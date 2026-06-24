# Admin Web 中文化 — Handoff 交接说明书

> 给接手执行的 AI 看。**主 session 已完成 Task 1 (分支创建)**,**Task 2-8 全部留给你**。

---

## 当前仓库状态(2026-06-24)

```
分支: feature/admin-web-zh-i18n  (off main @ c7a6f93)
基线: 41/41 tests pass (admin-web)

工作区有 3 个 modified 文件(来自上次的路由修复,本次 commit 一部分):
  M admin-web/src/components/Layout.tsx      # NavLink to="/users" 等 + 中文翻译待加
  M admin-web/src/components/PrivateRoute.tsx # <Navigate to="/login">
  M admin-web/src/pages/LoginPage.tsx         # navigate('/')

未追踪文件(无关,忽略):
  ?? docs/superpowers/specs/2026-06-23-v2-self-upload-and-pitch-design.md

已 commit 的文档:
  b6f3e5e docs(spec): admin-web 中文化 design
  f05dc55 docs(plan): admin-web 中文化 implementation plan
```

---

## 关键文件位置

| 文件 | 说明 |
|---|---|
| `docs/superpowers/specs/2026-06-24-admin-web-zh-i18n-design.md` | 翻译对照表、StatusBadge 映射、文件清单 |
| `docs/superpowers/plans/2026-06-24-admin-web-zh-i18n-plan.md` | 8 个 Task 的逐步执行步骤 |

---

## ⚠️ 重要:plan 中需要修正的 2 处

**我在写 plan 时 Read 拿到的文件内容是过期的(Read 工具返回了缓存内容)**,实际文件结构跟我以为的不同。请执行时参考下面的修正:

### 修正 1: `admin-web/src/lib/format.ts` 实际结构

**Plan 假设**: 只有 `relativeTime` 一个导出函数。

**实际**: 还导出了 `formatDate` 和 `statusColor`,完整签名:

```typescript
export function formatDate(iso: string): string;
export function relativeTime(iso: Date | string | number, now?: number): string;
export function statusColor(value: string): 'green' | 'yellow' | 'red' | 'gray' | 'blue';
```

`statusColor` 已经存在!StatusBadge 内部**已经**调用 `statusColor()`,不需要在 StatusBadge.tsx 里再加 `COLOR_MAP`。

**结论**:
- ❌ Plan Task 4.6 里写的"加 COLOR_MAP 到 StatusBadge.tsx"**作废**
- ✅ Plan Task 4.6 里写的"加 STATUS_LABELS 到 StatusBadge.tsx"**保留**
- StatusBadge 改成只翻译文字,颜色继续用 `statusColor()` 来自 `format.ts`

### 修正 2: `admin-web/tests/lib/format.test.ts` 实际结构

**Plan 假设**: 只有 `describe('relativeTime')` 一个块。

**实际**: 有 **3 个** describe 块,共 17 个 it:

```typescript
describe('formatDate', () => {           // 3 it — 不需要改
  it('formats ISO to YYYY-MM-DD HH:MM (local)', ...)
  it('returns empty for empty input', ...)
  it('returns original for invalid input', ...)
});

describe('relativeTime', () => {         // 6 it — 改英文期望为中文
  it('returns "just now" for < 60s', ...)         // → '刚刚'
  it('returns minutes for < 60min', ...)         // → '5 分钟前'
  it('returns hours for < 24h', ...)             // → '3 小时前'
  it('returns days for < 30d', ...)              // → '2 天前'
  it('returns months for < 12mo', ...)           // → '2 个月前'
  it('returns years for >= 1y', ...)             // → '2 年前'
});

describe('statusColor', () => {          // 4 it — 不需要改 (颜色名是英文)
  it('green for active states', ...)
  it('red for suspended/error states', ...)
  it('yellow for pending states', ...)
  it('gray for unknown', ...)
});
```

**结论**:
- ❌ Plan Task 2.1 里写的"完整替换 format.test.ts 为 8 个相对时间测试"**作废**
- ✅ 改成只改 `describe('relativeTime')` 块里的 6 个 `.toBe('X ago')` 为中文期望
- `formatDate` 和 `statusColor` 块保持不变

### 修正 3(小): 文件行尾是 CRLF

`tests/lib/format.test.ts` 是 CRLF 行尾 (`cat -A` 确认 `^M$`),Edit 时旧字符串要包含 `\r\n` 或者直接重新 Write 整个文件。建议 Write 整文件替换。

---

## 推荐执行顺序

按 plan 里 8 个 task 顺序执行即可,**应用上面 2 处修正**:

1. **Task 1** ✅ (已 done by 主 session — 分支已建好)
2. **Task 2** — 改测试期望为中文,跑测试 → FAIL
   - 用上面修正 2 的内容,只改 `describe('relativeTime')` 块
   - `UsersList.test.tsx` 和 `CandidatesList.test.tsx` 里 `'Next →'` → `'下一页'` 不变
3. **Task 3** — 改 `index.html`(lang + title)
4. **Task 4.1** — 改 `format.ts` 的 `relativeTime` 返回中文(其他函数不动)
5. **Task 4.2-4.5** — 改 Pagination / SearchBar / Table / AuditJsonDrawer(按 plan)
6. **Task 4.6** — 改 `StatusBadge.tsx`,**只加 STATUS_LABELS**,不动颜色(用上面修正 1)
7. **Task 4.7** — 改 Layout.tsx(品牌 + 5 nav + Logout 文字)
8. **Task 5.1-5.6** — 改 6 个 page
9. **Task 6** — 跑 `pnpm test` 期望 41/41 pass
10. **Task 7** — 浏览器手动验证(后端 3000 + admin-web 5174 在跑)
11. **Task 8** — 单 commit(包含路由修复 + 全部翻译)

---

## 状态保留(必须保留的)

- **3 个 modified 文件的路由修复改动必须保留**,作为本次 commit 的一部分(不能让它们丢失或回到英文)

---

## 验证清单(完成后回报)

- [ ] `pnpm test` → 41/41 pass
- [ ] `pnpm build` → 成功
- [ ] `pnpm tsc --noEmit` → 无 error
- [ ] 浏览器 http://localhost:5174/admin/login 显示 `猎头中介管理后台`
- [ ] Dashboard 8 个指标中文、Audit 3 tab 中文、Profile 5 label 中文
- [ ] StatusBadge 在 Users/Candidates/Audit 表里显示中文状态值
- [ ] `git log --oneline -1` 看到 commit message 包含 "中文化"
- [ ] `git status --short` 干净

---

## 联系

主 session 已停手。这个 HANDOFF 文件 + spec + plan 三件套就是完整上下文。