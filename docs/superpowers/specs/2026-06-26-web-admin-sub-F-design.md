# Sub-F: Worker Reads Config + Public Rate-Limit DB-Backed

**Date:** 2026-06-26
**Status:** Design (pre-implementation)
**Depends on:** v2.7.0 (Sub-E — Config DB-backed + Settings UI)

## 1. Background

Sub-E 把 config 迁移到了 DB-backed 表（`config` 表，DB-backed `config.set/list` API，SettingsPage UI），但**没有让任何业务运行时真正读它**：

- **Rate-limit** 仍然用 `RATE_LIMIT_BURSTS`（`src/shared/constants.ts`）硬编码常量
- **industry_map** 仍然 `readFileSync('config/industry_map.json')`（`src/main/modules/desensitize/mapping.ts:24`）
- **Webhook worker / cron scheduler** 不读 config（grep 0 results）
- **register IP limiter** `REGISTER_IP_LIMIT_PER_HOUR` 是模块内常量

结果：admin 通过 SettingsPage 改 `rate_limit.tier.headhunter.limit_per_minute` 后，**无任何运行时变化**——`RATE_LIMIT_BURSTS` 仍是源真值。sub-E 的"运营可调"是**欺骗性 UI**。

## 2. Goal

让 2 个业务运行时**真正读 DB 的 `config` 表**：

1. **Rate-limit middleware**：从 `RATE_LIMIT_BURSTS` 常量改为从 `config.rate_limit.tier.<tier>.limit_per_<window>` 读
2. **industry_map loader**：从 `readFileSync` 改为从 `config.industry_map` 读

管理员改 Config → 最多 10s 生效（10s 懒过期缓存）。

### 2.1 Non-Goals（不在范围）

- 不动 `QUOTA_COSTS`（`src/shared/constants.ts`）—— 业务配额，不是限流
- 不动 register IP limiter `REGISTER_IP_LIMIT_PER_HOUR`（用户决策"只 per-tier"）
- 不动 webhook worker / scheduler（不读 config）
- 不动 admin-web SettingsPage UI（Config CRUD 已有，10s 懒过期自动生效）
- 不做 cache invalidation API / 手动刷新按钮（YAGNI）

## 3. Architecture

### 3.1 新增：`src/main/modules/config-cache.ts`

单一 in-memory cache（`Map<string, { value: unknown; loadedAt: number }>`），对外暴露 2 个函数：

```typescript
export type ConfigCache = {
  /** Get cached value; reload from DB if expired (TTL 10s). DB error → throw. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Get cached value with fallback. DB error / no key → return fallback(). */
  getOrDefault<T = unknown>(key: string, fallback: () => T): Promise<T>;
  /** Test-only: invalidate single key or all. */
  invalidate(key?: string): void;
};

const TTL_MS = 10_000;
const cache = new Map<string, { value: unknown; loadedAt: number }>();

export function createConfigCache(db: DB, ttlMs: number = 10_000): ConfigCache { /* ... */ }
```

**实现要点：**
- **Lazy expiration**：每次 `get` 检查 `Date.now() - loadedAt > TTL_MS` → 重读 DB（无 `setInterval` 开销）
- **Fail-soft**：`getOrDefault` 内部 `try/catch` DB 错误，抛错时返 `fallback()`（最后一次成功缓存或硬编码）
- **首次懒加载**：服务启动时 cache 空，第一个请求 lazy 读 DB 写入
- **线程安全**：单 Node 进程，无需锁

### 3.2 改 3 处

#### 3.2.1 `server.ts` `migrateConfigFromFilesToDB`（Sub-E 已实现，扩 1 文件）

现有：读 `desensitization.json` + `commission.json`（**commission.json 不存在** — 是个 sub-E bug）
改为：读 3 个文件
- `desensitization.json`（保留）
- `commission.json`（**新增** — 当前不存在；首次运行会 warn 然后跳过）
- `industry_map.json`（**新增** — Sub-F 主目标）

如果文件不存在，**不报错**，仅 `console.warn`（dev 友好）。
INSERT OR IGNORE 语义不变：DB 已有 key 不被文件覆盖（admin 改过优先）。

#### 3.2.2 `src/main/modules/rate-limit/middleware.ts` 改用 configCache

**当前实现**（line 51）：
```typescript
const limits = RATE_LIMIT_BURSTS[user.user_type];
// 后续用 limits[window.key] 取 second/minute/hour
```

**改为**：
```typescript
const cache = createConfigCache(db);
const limits = {
  second: await cache.getOrDefault(
    `rate_limit.tier.${user.user_type}.limit_per_second`,
    () => RATE_LIMIT_BURSTS[user.user_type].second
  ),
  minute: await cache.getOrDefault(
    `rate_limit.tier.${user.user_type}.limit_per_minute`,
    () => RATE_LIMIT_BURSTS[user.user_type].minute
  ),
  hour: await cache.getOrDefault(
    `rate_limit.tier.${user.user_type}.limit_per_hour`,
    () => RATE_LIMIT_BURSTS[user.user_type].hour
  ),
};
```

**Cache 注入**：middleware 工厂 `createRateLimitMiddleware(db)` 改为 `createRateLimitMiddleware(db, cache)`，routes 调用点相应改。

**Middleware 改为 async** —— `req`/`res`/`next` 仍然 callback 风格，但内部 `await`。

#### 3.2.3 `src/main/modules/desensitize/mapping.ts` `loadIndustryMap()` 改用 configCache

**当前实现**（line 22-60）：
```typescript
let _cache: IndustryCache | null = null;

export function loadIndustryMap(): IndustryCache {
  if (_cache) return _cache;
  const path = join(process.cwd(), 'config', 'industry_map.json');
  let cfg: IndustryConfig;
  try { cfg = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { /* 最小 fallback */ }
  // ... build cache
  _cache = { companies, cfg, categoryOrder };
  return _cache;
}
```

**改为**：
```typescript
export function loadIndustryMap(db: DB): IndustryCache {
  if (_cache) return _cache;
  const cache = createConfigCache(db);
  // Read 'industry_map' key; fallback to file read (dev 友好)
  const cfg = await cache.getOrDefault<IndustryConfig>('industry_map', () => {
    const path = join(process.cwd(), 'config', 'industry_map.json');
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { /* minimal hardcoded fallback */ }
  });
  // ... build cache
  _cache = { companies, cfg, categoryOrder };
  return _cache;
}
```

**签名变化**：`loadIndustryMap()` → `loadIndustryMap(db)`。调用点相应改：
- `src/main/routes/config.ts:11` (`loadIndustryMap()` 2 处)
- `src/main/modules/desensitize/mapping.ts` (`lookupIndustry` 内部)

### 3.3 启动顺序（server.ts line 333-336，无变化）

```typescript
const env = loadEnv();
const db = openDb(env.DATABASE_PATH);
runMigrations(db);
migrateConfigFromFilesToDB(db);  // 扩为读 3 个文件
const app = createAppFromDb(db, env);
```

`configCache` 不在启动时 warmup——懒加载。

## 4. Data Flow

### 4.1 读路径（请求时，rate-limit middleware）

```
HTTP request → /v1/headhunter/*
  → authMiddleware
  → createRateLimitMiddleware(req, res, next)
       → for window in [second, minute, hour]:
            limits[tier][window] = await configCache.getOrDefault(
              `rate_limit.tier.${user.user_type}.limit_per_${window}`,
              () => RATE_LIMIT_BURSTS[user.user_type][window]
            )
            // 1. cache 命中 + 未过期 → 直接返
            // 2. cache 命中 + 已过期 → SELECT * FROM config WHERE key = ? → 写入 cache → 返
            // 3. cache 未命中 → SELECT * FROM config → 写入 cache → 返
            // 4. DB 抛错 → fallback() → 返硬编码常量
       → slidingWindowCheck(...)
```

### 4.2 写路径（admin 改 Config）

```
admin PUT /v1/admin/config/rate_limit.tier.headhunter.limit_per_minute
  body: { value: 200, reason: "doubled to handle Q3 spike" }
  ↓
config.set(adminUserId, key, value, reason)  // Sub-E 已实现
  ↓
INSERT OR UPDATE config (key, value_json, updated_at, updated_by_admin_user_id)
  ↓
INSERT INTO admin_action_log (action='update_config', details_json={value, reason})
  ↓
respond 200
  ↓
(**不** 主动 invalidate cache — 10s 懒过期自然收敛)
  ↓
≤ 10s 后，下一个 rate-limit 请求读 cache，发现过期 → 重读 DB → 拿到新值
```

### 4.3 启动路径

```
migrateConfigFromFilesToDB(db)  // 扩为读 3 文件
  ↓
for file in [desensitization, commission, industry_map]:
  if file exists:
    INSERT OR IGNORE INTO config (key, value_json, ...)
  else:
    console.warn(`[startup] config seed file not found: ${file}, skipping`)
  ↓
configCache 仍空
  ↓
首个请求 lazy 读 DB → 写入 cache
```

### 4.4 改 industry_map.json 路径（dev 改 seed）

```
dev 改 config/industry_map.json + 重启服务
  ↓
migrateConfigFromFilesToDB 用 INSERT OR IGNORE
  ↓
如果 DB 已经有 'industry_map' key（被 admin 改过）
  → INSERT OR IGNORE 跳过，DB 保留 admin 的新值
  → 启动 log 会 warn "industry_map already exists in DB, skipping seed"
  → 预期行为：dev 改文件不覆盖 ops 调整
```

## 5. Error Handling

| 场景 | 行为 |
|------|------|
| DB 抛错（连接断、迁移未完成） | `configCache.getOrDefault` 内部 `try/catch`，返 `fallback()` |
| Cache 命中但 value 是错误类型（DB 写了字符串） | `getOrDefault` 类型不匹配 → `fallback()` + `console.warn('[config-cache] invalid value for key=X, fallback to default')` |
| JSON 解析失败（admin 写了非 JSON） | Sub-E handler 已校验，DB 不会写入非法 JSON |
| 首次启动 DB 不可用 | 所有请求走 fallback，10s 后再尝试 lazy read，DB 恢复自动收敛 |
| 配置文件不存在（dev） | `migrateConfigFromFilesToDB` warn 然后跳过；`industry_map` fallback 走最小 hardcoded 集合（6 家公司，mapping.ts:33-46 现有逻辑） |
| 并发读 cache 同一过期 key | 接受 1-2 次重复 DB 读（无害；后续可加 dedup，YAGNI） |
| Cache 内存泄漏 | Map 大小 = 业务 config 数（< 100），可忽略；如需严格 LRU，加后续 sub-G |

## 6. Testing

### 6.1 新增 unit test

**`tests/unit/config-cache.test.ts`** — 覆盖：
1. 首次 `get` 触发 DB read + 写入 cache
2. TTL 内重复 `get` 不重读 DB
3. TTL 过期后 `get` 重读 DB
4. `invalidate(key)` 后下次 `get` 重读
5. `invalidate()`（无参）清空所有
6. `getOrDefault` 在 DB 抛错时返 fallback
7. `getOrDefault` 在 key 不存在时返 fallback
8. 并发 10 个 `get` 同 key，DB 收到 1 次 read（lazy load + 不去重——接受 1-2 次重复）
9. value 类型不匹配时 fallback（用 number fallback 测 string key）

### 6.2 新增 integration test

**`tests/integration/rate-limit-config.test.ts`** — 覆盖：
1. 初始无 config key → middleware 用 `RATE_LIMIT_BURSTS` 常量（fallback）
2. admin PUT `rate_limit.tier.headhunter.limit_per_minute=200` → 第一个请求 fallback（cache 还没到），10s 后下一个请求用新值 200
3. TTL=10s 跨测试加速：把 `TTL_MS` 暴露为 `createConfigCache(db, ttlMs = 10_000)` 可注入参数（测试用 `ttlMs: 50`，避免 mock Date.now 的副作用）
4. DB 关掉模拟 → middleware 仍工作（用 fallback），不会 500
5. key 改坏（非数字）→ middleware fallback + 仍 200

**`tests/integration/industry-map-config.test.ts`** — 覆盖：
1. DB 没 `industry_map` key → fallback 到文件 readFileSync
2. admin PUT `industry_map` 为新 JSON → 10s 后 `lookupIndustry('新公司名')` 返新 category
3. 文件改了 + DB 已有 key → DB 优先，文件不覆盖
4. 启动时 `migrateConfigFromFilesToDB` 读 `industry_map.json` 写入 DB（用真文件）

**`tests/integration/migrate-config-files.test.ts`** — 覆盖（Sub-E 缺失）：
1. `desensitization.json` 存在 → INSERT OR IGNORE 到 config 表
2. `industry_map.json` 存在 → INSERT OR IGNORE 到 config 表
3. `commission.json` 不存在 → console.warn 跳过，不报错
4. 第二次跑 `migrateConfigFromFilesToDB`（模拟重启）→ 不覆盖已有 key

### 6.3 现有测试保持

- `tests/integration/admin-endpoints.test.ts` 改 config admin 测试 — 不动
- `tests/integration/skill-md-conformance/admin-coverage.test.ts` 测 `admin.get_config` / `admin.put_config` — 不动
- `tests/integration/admin-config-endpoints.test.ts`（Sub-E 新增 10 case）— 不动
- `src/main/modules/rate-limit/middleware.ts` 现有测试 — 不动（行为不变，只是数据源换了）

### 6.4 不在范围

- 不测 Web admin UI（react 组件层；admin-web 已经在 e2e 覆盖 SettingsPage）
- 不测 webhook / scheduler（不读 config）

## 7. Known Limitations

1. **冷启动延迟**：首次请求 lazy 读 DB 会有 ~1-2ms 延迟（DB hit）。可接受。
2. **多进程部署**：当前是单 Node 进程，cache in-memory OK。如果未来横向扩展，每个进程各自缓存 10s 内的旧值（不一致窗口 10s，可接受）。
3. **手动 invalidate 缺失**：调试时如果想立即看到效果，需要 `kill -HUP` 或等 10s。不做强制 invalidate API（YAGNI）。
4. **Fallback 退化**：DB 持续不可用 → 全员用 hardcoded 常量。可能与 admin 在 DB 设的值不一致，但保证可用性（rate-limit 不会崩全站）。
5. **Cache 类型安全弱**：`get<T>` 是运行时校验，TypeScript 编译时不知道 T 实际是什么。Fail-soft + warn 兜底。
6. **commission.json 缺失**：Sub-E 引用了不存在的 `commission.json`，sub-F 顺手修：扩 `migrateConfigFromFilesToDB` 时兼容"文件不存在"warn 但不报错。

## 8. Out of Scope (future)

- **Sub-G**：public rate-limit 暴露为公开 endpoint（`GET /v1/config/rate-limits`），让 Agent 提前看到限流值
- **Sub-G+**：register IP limiter 接入 Config（用户决策暂时不做）
- **Sub-H**：commission.json seed + admin 接入（如果未来要 admin 调 commission rate）
- **Sub-I**：cache invalidation API（手动 / SIGHUP）
- **Sub-J**：LRU cache + 大 key 监控（如果 config 数量 > 1000）
- **Sub-K**：webhook worker 接入 Config（如果未来加 webhook 路由规则）

## 9. Estimated Effort

- 1 个新文件：`config-cache.ts` (~80 行 + 60 行 test) → 半天
- 改 `migrateConfigFromFilesToDB` 兼容 3 文件 → 1 小时
- 改 `rate-limit/middleware.ts` 用 cache → 半天
- 改 `desensitize/mapping.ts` 用 cache + 改 caller → 半天
- 集成测试 3 个文件 → 1 天
- 全验证 + CHANGELOG + commit → 2 小时

总计：~3-4 天（与 sub-E 一样 1 周 sprint 内的预算）

## 10. Risk Assessment

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Cache lazy read 与 admin write race（中间有 10s 不一致窗口） | 高 | 低 | 设计意图如此，admin 改完最多 10s 生效 |
| DB 挂掉导致全站用硬编码限流 | 低 | 中 | Fail-soft + console.error + （可加 alert，未来） |
| Cache 内存无限增长 | 极低 | 低 | Map 大小 = config 数（< 100），可忽略 |
| Industry_map 从 file 改 DB 后 cold start 慢 | 低 | 低 | 启动 + 首次 lookup 才有；可接受 |
| 改 `loadIndustryMap` 签名 break 现有 caller | 中 | 中 | grep 一次性改全；加 typecheck 保护 |
| admin put 了非法 rate_limit value（如负数）| 中 | 中 | handler 校验 value 是 number；middleware 兜底 fallback + warn |

---

## Appendix A: Config Keys Affected

| Key | 用途 | 默认 fallback | 写时校验 |
|-----|------|--------------|---------|
| `rate_limit.tier.candidate.limit_per_second` | 每秒 limit | `RATE_LIMIT_BURSTS.candidate.second` = 10 | number > 0 |
| `rate_limit.tier.candidate.limit_per_minute` | 每分 limit | 50 | number > 0 |
| `rate_limit.tier.candidate.limit_per_hour` | 每时 limit | 300 | number > 0 |
| `rate_limit.tier.headhunter.limit_per_<window>` | 同上，3 window | second=20 / minute=100 / hour=750 | number > 0 |
| `rate_limit.tier.employer.limit_per_<window>` | 同上，3 window | second=30 / minute=200 / hour=1200 | number > 0 |
| `industry_map` | 完整 industry map JSON | `readFileSync('config/industry_map.json')` | valid JSON, has `categories` array |

## Appendix B: 改动文件清单

| File | Action | Lines |
|------|--------|-------|
| `src/main/modules/config-cache.ts` | **新增** | ~80 |
| `tests/unit/config-cache.test.ts` | **新增** | ~60 |
| `server.ts` (`migrateConfigFromFilesToDB`) | 改 | +5 |
| `src/main/modules/rate-limit/middleware.ts` | 改 | +15 / -3 |
| `src/main/routes/{candidate,headhunter,employer,notifications}.ts` (4 files) | 改 caller | +4 each |
| `src/main/modules/desensitize/mapping.ts` | 改 | +8 / -3 |
| `src/main/routes/config.ts` (2 calls) | 改 caller | +2 each |
| `tests/integration/rate-limit-config.test.ts` | **新增** | ~80 |
| `tests/integration/industry-map-config.test.ts` | **新增** | ~60 |
| `tests/integration/migrate-config-files.test.ts` | **新增** | ~50 |
| `docs/CHANGELOG.md` | 改 | +20 |
