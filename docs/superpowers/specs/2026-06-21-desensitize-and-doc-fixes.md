# 文档与脱敏 Bug 修复 Spec（紧凑版）

**状态**: Draft
**日期**: 2026-06-21
**作者**: 自查报告（基于其他 AI 跑流程发现的 6 个坑 + 3 个不确定项）
**优先级**: 1 项 P0 代码修复 + 4 项文档修正

---

## 1. 概述

其他 AI 跑流程时报告 6 个坑 + 3 个不确定项。逐项核查后真实需要修的：

| # | 项 | 类型 | 工作量 |
|---|---|---|---|
| 1 | title_level 正则太窄 — "高级算法工程师"等被分到"其他" | P0 代码 | 5 行 |
| 2 | view_url 文档说"24h JWT" — 代码是"1h random hex" | P0 文档 | 3 行 |
| 3 | industries 文档说"22+" — 实际 12 | P1 文档 | 2 行 |
| 4 | §5.2 quota 表没指向 endpoint 表（被误以为不全） | P2 文档 | 1 行 |
| 5 | demo 数据边界未文档化 | P2 文档 | 1 段 |

**非目标**（误报或 working as intended）：
- GBK stdout（脚本问题，非产品）
- TypeError on None（脚本问题）
- FORBIDDEN demo 雇主（RBAC 正确）
- INVALID_STATE 连锁（#4 衍生）
- webhook 重试 1s/4s/16s（代码已对，未验证是测试覆盖问题）

---

## 2. 修复 1 — title_level 正则扩范围（P0 代码）

### 根因

`src/main/modules/desensitize/mapping.ts:95-102`：
```typescript
export const TITLE_LEVEL_PATTERNS: { regex: RegExp; level: string }[] = [
  { regex: /P[5-7]|高级工程师|高级.*?(?:开发|前端|后端|测试|架构|运维|研发)/, level: 'P6' },
  { regex: /P[8-9]|资深|专家|Staff|Principal/, level: 'P7+' },
  ...
];
```

`高级算法工程师` 不匹配：
- `高级工程师` 需字面连续 → 不行（中间有"算法"）
- `高级.*?开发|前端|...|研发` 需后缀匹配 → "算法工程师"不在后缀列表 → 不行

### 修复

把 `高级.*?(?:开发|前端|后端|测试|架构|运维|研发)` 改为 `高级.*?工程师`，让"高级<任意词>工程师"都匹配 P6。

```typescript
{ regex: /P[5-7]|高级.*?工程师|资深.*?工程师/, level: 'P6' },
```

同时把 line 98 的 `资深` 模式也加上 `资深.*?工程师`，避免类似漏判：

```typescript
{ regex: /P[8-9]|资深.*?工程师|专家|Staff|Principal/, level: 'P7+' },
```

### 测试

新增 `tests/unit/desensitize-title-level.spec.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { TITLE_LEVEL_PATTERNS } from '../../src/main/modules/desensitize/mapping';

function classify(title: string): string {
  for (const p of TITLE_LEVEL_PATTERNS) {
    if (p.regex.test(title)) return p.level;
  }
  return '其他';
}

describe('title level regex (Bug fix)', () => {
  it('matches 高级算法工程师 → P6', () => {
    expect(classify('高级算法工程师')).toBe('P6');
  });
  it('matches 高级数据工程师 → P6', () => {
    expect(classify('高级数据工程师')).toBe('P6');
  });
  it('matches 高级AI工程师 → P6', () => {
    expect(classify('高级AI工程师')).toBe('P6');
  });
  it('matches 资深算法工程师 → P7+', () => {
    expect(classify('资深算法工程师')).toBe('P7+');
  });
  it('still matches 高级前端工程师 → P6 (regression)', () => {
    expect(classify('高级前端工程师')).toBe('P6');
  });
  it('still matches 高级工程师 (literal) → P6 (regression)', () => {
    expect(classify('高级工程师')).toBe('P6');
  });
  it('still matches P5/P6/P7 literal → P6 (regression)', () => {
    expect(classify('P5 Java 工程师')).toBe('P6');
  });
  it('non-senior 工程师 → 其他', () => {
    expect(classify('工程师')).toBe('其他');
  });
});
```

---

## 3. 修复 2 — view_url 文档修正（P0 文档）

### 现状错误

`docs/superpowers/skill.md:485`：
> token 是 HMAC 签名 JWT，**24h 过期**

实际 `src/main/modules/view/generate.ts:4`：
```typescript
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
```
且 line 20：`const token = randomBytes(32).toString('hex');` — 是 random hex，**不是 JWT**。

### 修复

将 skill.md line 485 改为：

```markdown
- token 是 32 字节随机 hex（无签名），**1h 过期**。过期后访问返回 410 Gone。
```

同时检查 line 1209 表格：
```markdown
| 同一 token 24h 后访问 | 410 Gone | **JWT 过期** |
```
改为：
```markdown
| 同一 token 1h 后访问 | 410 Gone | **token 过期** |
```

---

## 4. 修复 3 — industries 数量文档修正（P1 文档）

### 现状错误

`skill.md:88`：
> "22+ 家公司"

`skill.md:898`：
> "22+ 行业 × 40+ 职级"

实际 `config/industry_map.json` 有 **12 categories** + `其他` default = 13。

### 修复

`skill.md:88` 改为：
```markdown
> 💡 **动态配置优先**：行业列表（12+ 类别）、职级正则、薪资带宽、市场排行 — 都通过 `GET /v1/config/*` 与 `/v1/market/*` 实时查询，**不要硬编码**。
```

`skill.md:898` 改为：
```markdown
> - 不加过滤直接拉全量——会被 12+ 行业 × 4 职级级别淹死
```

---

## 5. 修复 4 — §5.2 quota 表加指针（P2 文档）

### 现状

`skill.md:330-339` 是分类概要表（6 个类别），但没指向 §4.x 的完整 endpoint 表。其他 AI 误以为 withdraw 等操作没列。

### 修复

在 §5.2 表后加一行：

```markdown
> 💡 上表是按成本档位的概要。完整逐接口配额见 §4 各角色 endpoint 表格。
```

---

## 6. 修复 5 — demo 数据边界文档化（P2 文档）

### 现状

`README.md` 没有说明 demo 数据用途。`tmp/seed-v4-demo.ts` 文件有顶部注释但 README 没引用。

### 修复

在 `README.md` 找到一个合适位置（"启动"或"测试数据"章节）加：

```markdown
## Demo 数据

`tmp/seed-v4-demo.ts` 注入 10 个模拟雇主（`demo_emp_*`）+ 30 个模拟岗位（`demo_j_*`），用于首页填充。

- **dev 模式**（默认）：首页显示 demo 数据
- **prod 模式**（`NODE_ENV=production`）：首页自动过滤 demo 数据
- **API 端点**：demo 数据始终可查询（agent 测试用）

执行：`node --import tsx tmp/seed-v4-demo.ts`
清理：脚本幂等，再次执行会自动清理旧 demo 数据并重新插入。
```

---

## 7. 文件变更总览

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/main/modules/desensitize/mapping.ts` | MODIFY | +2 -2（regex 行） |
| `tests/unit/desensitize-title-level.spec.ts` | NEW | ~50 行 |
| `docs/superpowers/skill.md` | MODIFY | ~6 行（4 处） |
| `README.md` | MODIFY | ~10 行 |

**合计**：~70 行（1 个 P0 代码修复 + 1 个新测试 + 5 处文档修正）

---

## 8. 测试策略

- 单测：`desensitize-title-level.spec.ts`（修复 1）
- 现有 491 测试不应回归
- 不做新集成测试（修复 2-5 都是文档，无功能性）

---

## 9. 完成定义

- [ ] 修复 1：8 个新单测全过 + 不破坏 4 个 v1 既有测试
- [ ] 修复 2：skill.md line 485 + 1209 改"1h" + 去"JWT"
- [ ] 修复 3：skill.md line 88 + 898 改"12+"
- [ ] 修复 4：§5.2 表后加指针
- [ ] 修复 5：README 加 demo 数据章节
- [ ] `pnpm typecheck` 0 errors
- [ ] `pnpm test` 全 pass（491 + 8 = 499 tests）