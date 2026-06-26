# Sub-G: Public Rate-Limit + Commission Config + Cache TTL 0s

**Date:** 2026-06-26
**Status:** Design (pre-implementation)
**Depends on:** v2.8.0 (Sub-F — Config DB-backed + Worker reads Config)

## 1. Background

Sub-F 让 worker 真正读 `config` 表，但还有 3 个用户可感知的"运营控制"缺口：

1. **Agent 不能预知 rate-limit 阈值** — 必须撞 429 才知道限流。生产部署时 agent 试探成本高。
2. **commission rate 硬编码** — `src/main/modules/commission/handler.ts` 写死 `0.1`（10%），无法运营调优。
3. **admin 改 Config 后最多 10s 生效**（Sub-F TTL=10s） — ops 调阈值后 debug 时等 10s 烦。

Sub-G 把这 3 块一并解决。

## 2. Goal

1. **公开 rate-limit endpoint** — `GET /v1/config/rate-limits` 返所有 tier × window 阈值，让 agent 预读
2. **commission 接入 Config** — 1 key `commission.platform_rate`，handler 读 configCache（fallback 0.1）
3. **cache invalidation 简化** — TTL 默认 `0s`（每次重读 DB），admin 改后**立即**生效

### 2.1 Non-Goals

- 公开 commission endpoint（Sub-H 候选）
- 多进程 cache invalidation（单进程足够）
- commission 拆分（hunter / referrer 比例）— Sub-H
- 公开 rate-limit endpoint 含 register IP limiter（Sub-G+ 候选）
- LRU + 大 key 监控（YAGNI）
- DB 主动推送（LISTEN/NOTIFY 等）— 单进程足够

## 3. Architecture

### 3.1 改 5 处

| File | Change | Reason |
|---|---|---|
| `src/main/modules/config-cache.ts` | TTL 默认值 `10000` → `0` | admin 改后立即生效 |
| `src/main/modules/admin/handlers/config.ts` | +`getRateLimits()` 方法 | 给 `GET /v1/config/rate-limits` 用 |
| `src/main/routes/config.ts` | +1 route `GET /rate-limits` | 新公开 endpoint |
| `src/main/schemas/admin.ts` | +`ListRateLimitsResponseSchema` | response shape |
| `src/main/modules/commission/handler.ts` | 读 `commission.platform_rate` configCache | commission rate 接入 |
| `src/main/server.ts` `migrateConfigFromFilesToDB` | commission 文件不存在时 INSERT 默认值 0.1 | 启动 seed |

### 3.2 改 config-cache TTL 默认值

```typescript
// before:
export function createConfigCache(db: DB, ttlMs: number = 10_000): ConfigCache { ... }

// after:
export function createConfigCache(db: DB, ttlMs: number = 0): ConfigCache { ... }
```

`ttlMs = 0` 意味着 `isExpired(loadedAt)` 永远 true（`Date.now() - loadedAt > 0`），所以每次 `get` 都重读 DB。`getOrDefault` 行为不变（DB miss/抛错 → fallback）。

### 3.3 新 endpoint: `GET /v1/config/rate-limits`

仿 `/v1/config/industries` pattern（`/v1/config/*` 在 PROJECT_MEMORY §1 公开端点白名单）。

**Handler**（`src/main/routes/config.ts`）：

```typescript
router.get('/rate-limits', (req: Request, res: Response) => {
  const authedUser = (req as any).user;
  if (authedUser) {
    const r = quota.tryConsume(authedUser.id, QUOTA_COSTS.config_lookup ?? 1);
    if (!r.ok && r.reason === 'INSUFFICIENT_QUOTA') {
      return res.status(429).json({ ok: false, error: { code: 'INSUFFICIENT_QUOTA', message: 'Daily quota exceeded' } });
    }
  }
  const data = config.getRateLimits();
  respond(res, ListRateLimitsResponseSchema, { ok: true, data });
});
```

**`getRateLimits()` 实现**（`src/main/modules/admin/handlers/config.ts`）：

```typescript
getRateLimits(): ListRateLimitsResponse {
  const tiers = ['candidate', 'headhunter', 'employer'] as const;
  const result: Record<string, Record<string, number>> = {};
  for (const tier of tiers) {
    result[tier] = {
      second: cache.getOrDefault(`rate_limit.tier.${tier}.limit_per_second`, () => RATE_LIMIT_BURSTS[tier].second),
      minute: cache.getOrDefault(`rate_limit.tier.${tier}.limit_per_minute`, () => RATE_LIMIT_BURSTS[tier].minute),
      hour:   cache.getOrDefault(`rate_limit.tier.${tier}.limit_per_hour`,   () => RATE_LIMIT_BURSTS[tier].hour),
    };
  }
  return { tiers: result, windows: ['second', 'minute', 'hour'] };
}
```

**Schema**（`src/main/schemas/admin.ts`）：

```typescript
const ListRateLimitsResponseSchema = EnvelopeSchema(z.object({
  tiers: z.object({
    candidate: z.object({ second: z.number(), minute: z.number(), hour: z.number() }),
    headhunter: z.object({ second: z.number(), minute: z.number(), hour: z.number() }),
    employer:   z.object({ second: z.number(), minute: z.number(), hour: z.number() }),
  }),
  windows: z.array(z.enum(['second', 'minute', 'hour'])),
}));
```

**示例 response**：

```json
{
  "ok": true,
  "data": {
    "tiers": {
      "candidate":  { "second": 10, "minute": 50, "hour": 300 },
      "headhunter": { "second": 20, "minute": 100, "hour": 750 },
      "employer":   { "second": 30, "minute": 200, "hour": 1200 }
    },
    "windows": ["second", "minute", "hour"]
  }
}
```

### 3.4 commission 接入 Config

**Key**：`commission.platform_rate`（1 key，double 0-1）

**Handler 改动**（`src/main/modules/commission/handler.ts`）：

```typescript
// before (in split):
const PLATFORM_FEE_RATE = 0.1;

// after:
constructor(db, encryptionKey, notifTrigger) {
  this.cache = createConfigCache(db);
}
async split(primary, referrer) {
  const platformRate = await this.cache.getOrDefault<number>(
    'commission.platform_rate',
    () => 0.1
  );
  // ... use platformRate instead of PLATFORM_FEE_RATE
}
```

**Migrate 启动 seed**（`src/main/server.ts`）：

```typescript
function migrateConfigFromFilesToDB(db: any) {
  const configDir = path.join(process.cwd(), 'config');
  if (!fs.existsSync(configDir)) return;
  const files = ['desensitization.json', 'commission.json', 'industry_map.json'];
  for (const f of files) {
    const full = path.join(configDir, f);
    if (!fs.existsSync(full)) {
      // Sub-G: commission.json 默认值 0.1（如果文件不存在）
      if (f === 'commission.json') {
        const now = new Date().toISOString();
        db.prepare('INSERT OR IGNORE INTO config (key, value_json, updated_at, updated_by_admin_user_id) VALUES (?, ?, ?, NULL)')
          .run('commission', JSON.stringify({ platform_rate: 0.1 }), now);
      }
      continue;
    }
    // ... existing readFileSync + INSERT OR IGNORE
  }
}
```

**为什么不读 `commission.json` 文件** — 文件当前不存在（之前 grep `config/` 只有 desensitization + industry_map）。默认 seed 0.1 保证 DB 总有 commission key。

### 3.5 关键决策映射

| Brainstorm 决策 | 落地 |
|---|---|
| 3 块全上 | 1 spec 覆盖全部 3 块 |
| 公开 rate-limit endpoint 加 | 3.3 节 |
| commission 1 个 rate | `commission.platform_rate` |
| TTL 缩到 0s | 3.2 节（config-cache 签名不变）|
| 一起交付 | 1 spec + 1 plan + 1 次部署 |

## 4. Data Flow

### 4.1 公开 rate-limit 读路径

```
HTTP GET /v1/config/rate-limits
  → optionalAuthMiddleware (SUB-E pattern, 仿 /v1/config/industries)
  → if authed: quota.tryConsume(id, config_lookup=1)
  → config.getRateLimits() (TTL=0, 每次重读 DB)
    → 9 次 cache.getOrDefault (3 tier × 3 window)
    → 每次: SELECT * FROM config WHERE key = ?
    → DB miss → RATE_LIMIT_BURSTS fallback
    → DB 抛错 → RATE_LIMIT_BURSTS fallback + warn
  → respond ListRateLimitsResponseSchema
```

**响应时间**：9 次 SQLite SELECT（in-memory ~1ms each）→ 端到端 ~10ms。可接受。

### 4.2 commission 写路径

```
admin PUT /v1/admin/config/commission.platform_rate
  body: { value: 0.15, reason: "Q3 promotion" }
  → config.set(adminUserId, key, 0.15, reason)
    → INSERT OR UPDATE config
    → INSERT admin_action_log (action=update_config, details_json={value, reason})
  → respond 200
  → (TTL=0) 下次 commission.split() 调用 → 立即返 0.15
```

### 4.3 commission handler 读路径

```
placement handler → commission.split(primary, referrer)
  → cache.getOrDefault('commission.platform_rate', () => 0.1)
    → cache miss (TTL=0) → SELECT value_json FROM config WHERE key = 'commission.platform_rate'
    → parse → 0.15 (admin 改过的值)
    → 用 0.15 计算 splits
```

### 4.4 migrate 启动路径

```
migrateConfigFromFilesToDB:
  for f in [desensitization, commission, industry_map]:
    if file exists:
      INSERT OR IGNORE (file content)
    else if f == 'commission':
      INSERT OR IGNORE (default {platform_rate: 0.1})
    else:
      console.warn + skip
```

## 5. Error Handling

| 场景 | 行为 |
|---|---|
| DB 抛错（rate-limit endpoint） | `cache.getOrDefault` 返 `RATE_LIMIT_BURSTS` fallback + warn |
| DB 抛错（commission handler） | `cache.getOrDefault` 返 `0.1` fallback + warn |
| `commission.platform_rate` key 缺失 | fallback `0.1`（migrate 启动保证有默认值）|
| `commission.platform_rate` 写入非 number | `cache.getOrDefault` 内部不校验 type（runtime cast），可能返回 NaN — handler 防御性 `Number.isFinite()` 检查 |
| `commission.platform_rate` 超出 [0, 1] | 写入时校验（**route 层 `PUT /v1/admin/config/:key` 加 key-aware Zod 校验**：`commission.platform_rate` 用 `z.number().min(0).max(1)`，其他 key 保持 `z.unknown()`）|
| TTL=0 性能 | 每次 request 9 DB read（rate-limit endpoint）+ 1 DB read（commission handler）。SQLite in-memory < 1ms，端到端 < 10ms |
| TTL=0 + DB 高并发 | SQLite 单文件锁可能 contention。已有配置（PRAGMA journal_mode=WAL）— Sub-D 验证过 |
| `GET /v1/config/rate-limits` 公开返回所有 tier | 设计意图 — agent 应该知道所有 tier 的限制 |

## 6. Testing

### 6.1 新增 unit test

无（业务逻辑简单，复用 config-cache 已有 unit test）。

### 6.2 新增 integration test

**`tests/integration/rate-limit-public.test.ts`** (~3 case)
1. 公开 endpoint 无 auth 返 200 + 完整 shape（3 tier × 3 window）
2. optional auth 触发 quota 扣减（`config_lookup`）
3. admin put `rate_limit.tier.headhunter.limit_per_minute=200` → 公开 endpoint 立即返新值（TTL=0 验证）

**`tests/integration/commission-config.test.ts`** (~3 case)
1. 默认 `0.1`（migrate 启动 seed 写入）
2. PUT `0.15` → 下次 commission split 用新值
3. DB 抛错 → handler fallback `0.1`（mock DB 失败）

### 6.3 现有测试保持

- `tests/integration/rate-limit-config.test.ts` (Sub-F) — `expect(res.headers['ratelimit-limit']).toBe('20, 100, 750')` 仍然过（rate-limit middleware 用同样 cache）
- `tests/integration/admin-config-endpoints.test.ts` (Sub-E) — 仍然过
- `tests/integration/commission-*.test.ts` (现有) — handler 改动不影响外部行为（fallback 保持 `0.1` 默认）

### 6.4 不在范围

- 不测 public endpoint 在 prod 的实际延迟
- 不测 commission 拆分（Sub-H 范围）

## 7. Known Limitations

1. **TTL=0 退化风险**：DB 挂掉时 cache 永远 miss → 每次都 fallback → 正常但延迟 +X ms。Sub-F 已验证 fail-soft。生产监控：DB 健康。
2. **多进程部署**：每个进程各自缓存，TTL=0 仍然有效（每次都查 DB）。无一致性问题。
3. **commission 单 rate**：当前不支持 hunter/referrer 比例拆分（Sub-H 候选）。
4. **`commission.platform_rate` Zod 校验**：handler 写值时校验 [0, 1]，但 read path 不二次校验（信任 DB）。如果 admin PUT 写入 `null` 或字符串，handler 拿到 `NaN` — 防御性 cast。
5. **公开 endpoint 无缓存**：每次都查 DB + 拼装 response。生产可加 `Cache-Control: public, max-age=60`（后续 Sub-G+）。

## 8. Out of Scope (future)

- **Sub-G+** (rate-limit 公开 endpoint 扩展)：register IP limiter 公开 + admin override
- **Sub-H** (commission 拆分)：hunter / referrer / platform 3 key；公开 GET /v1/config/commission
- **Sub-I** (cache invalidation API)：admin POST 手动 invalidate（如果需要，TTL=0 已经够用）
- **Sub-J** (multi-process invalidation)：Redis pub/sub 或 DB LISTEN/NOTIFY
- **Sub-K** (公开 endpoint Cache-Control)：ETag + 60s 边缘缓存

## 9. Estimated Effort

| Task | Estimate |
|---|---|
| TTL 默认值 0（config-cache 1 行改动） | 5 分钟 |
| `getRateLimits()` + schema + route | 1 小时 |
| commission handler 改用 configCache | 1 小时 |
| migrate 默认值 0.1 | 30 分钟 |
| 2 个 integration test | 2 小时 |
| 全验证 + CHANGELOG + commit | 1 小时 |

总计：**5-6 小时**（1 个工作日）

## 10. Risk Assessment

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| TTL=0 + DB 性能问题 | 低 | 中 | SQLite in-memory < 1ms；现有 test 已验证 |
| commission 改 `0` 改 `1` 业务异常 | 中 | 中 | Zod 校验 [0, 1]；handler `Number.isFinite` 防御 |
| 公开 endpoint 暴露限流被攻击 | 低 | 低 | 读 only；无 PII；无修改面 |
| `getRateLimits` 实现错误（typo） | 中 | 中 | integration test 覆盖 |
| commission handler 改后没迁移 | 中 | 高 | 全量 commission test + smoke test |

## Appendix A: Endpoint 列表

| Endpoint | Method | Auth | 用途 |
|---|---|---|---|
| `/v1/config/industries` | GET | optional | 已有 — industry list |
| `/v1/config/title_levels` | GET | optional | 已有 — title level regex |
| `/v1/config/salary_bands` | GET | optional | 已有 — salary bands |
| **`/v1/config/rate-limits`** | **GET** | **optional** | **新 — Sub-G** |
| `/v1/admin/config` | GET | admin | 已有 — list config keys |
| `/v1/admin/config/:key` | PUT | admin | 已有 — upsert |
| `/v1/admin/config/cache/invalidate` | POST | admin | 暂不加（Sub-I 候选）|

## Appendix B: Config Keys

| Key | 用途 | 默认 fallback | 写时校验 |
|---|---|---|---|
| `rate_limit.tier.<tier>.limit_per_<window>` | Sub-F | `RATE_LIMIT_BURSTS[tier][window]` | number > 0 |
| `industry_map` | Sub-F | `readFileSync('config/industry_map.json')` | valid JSON, has `categories` array |
| **`commission.platform_rate`** | **Sub-G** | **`0.1`** | **number, 0 ≤ x ≤ 1** |

## Appendix C: 改动文件清单

| File | Action | Lines |
|---|---:|---:|
| `src/main/modules/config-cache.ts` | Modify | +1 / -1 |
| `src/main/modules/admin/handlers/config.ts` | Modify | +20 |
| `src/main/routes/config.ts` | Modify | +15 |
| `src/main/schemas/admin.ts` | Modify | +12 |
| `src/main/modules/commission/handler.ts` | Modify | +10 / -5 |
| `src/main/server.ts` | Modify | +7 |
| `tests/integration/rate-limit-public.test.ts` | New | ~70 |
| `tests/integration/commission-config.test.ts` | New | ~70 |
| `docs/CHANGELOG.md` | Modify | +25 |
