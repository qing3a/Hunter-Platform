# Hunter Platform 运维指南

> 此文档面向**部署方 / SRE / 平台管理员**，与 agent skill.md 分离。
> Agent 不需要看这里。

---

## 1. 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `PLATFORM_ENCRYPTION_KEY` | ✅ | — | AES-256-GCM 密钥，base64 of 32 bytes。单 key 模式。 |
| `PLATFORM_ENCRYPTION_KEYS` | ❌ | — | 多 key 轮换模式：`v1:<b64>,v2:<b64>`，最新 key 用于加密 |
| `WEBHOOK_HMAC_SECRET` | ✅ | — | webhook 签名密钥，≥ 16 字符 |
| `ADMIN_PASSWORD_HASH` | ✅ | — | bcrypt 哈希 |
| `DATABASE_PATH` | ❌ | `./data/hunter.db` | SQLite 文件路径 |
| `PORT` | ❌ | `3000` | HTTP 监听端口 |
| `NODE_ENV` | ❌ | `development` | `development` / `test` / `production` |
| `LOG_LEVEL` | ❌ | `info` | `debug` / `info` / `warn` / `error` |
| `RATE_LIMIT_ENABLED` | ❌ | `true` | `false` 关闭所有限流（仅本地开发） |

---

## 2. 加密密钥轮换

加密 payload 格式：`v1:<base64(iv||tag||ciphertext)>`。`v1:` 前缀让 decrypt 能区分版本。

### 模式 1：单 key（默认）
```bash
PLATFORM_ENCRYPTION_KEY=<base64 32 字节>
```

### 模式 2：多 key 轮换
```bash
export PLATFORM_ENCRYPTION_KEYS="v1:$(openssl rand -base64 32),v2:$(openssl rand -base64 32)"
```
- **最新 key（v2）用于加密**
- 旧 key（v1）用于解密遗留数据
- 客户端无需改任何代码

> ⚠️ 旧格式（无 `v1:` 前缀）已停止支持。如有遗留数据需先重新加密。

---

## 3. 后台任务

| 任务 | 表达式 | 行为 |
|------|--------|------|
| `quota-reset` | `0 0 * * *`（每日 UTC 0）| 重置所有 active user 的 `quota_used = 0` |
| `rate-limit-cleanup` | `0 * * * *`（每小时）| 删除 `expires_at < now` 的 rate_limit_buckets |
| `audit-archive` | `0 0 1 * *`（每月 1 号）| 删除 90 天前的 action_history |

---

## 4. 优雅关闭

HTTP `close` 事件触发：
- `stopMetricsRefresh()` — 停止 Prometheus 指标刷新
- `stopScheduler()` — 停止 cron 任务

部署方应监听 `SIGINT` / `SIGTERM` 并优雅关闭。

---

## 5. 数据库迁移

迁移版本控制 `src/main/db/migrations/`。升级流程：
1. 启动时自动应用新 migration
2. 不可回滚（v1 不支持 downgrade）
3. v008 是当前最新（GDPR soft-delete）