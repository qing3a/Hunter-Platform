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
## 1. 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `PLATFORM_ENCRYPTION_KEY` | ✅ | — | AES-256-GCM 密钥，base64 of 32 bytes。单 key 模式。 |
| `PLATFORM_ENCRYPTION_KEYS` | ❌ | — | 多 key 轮换模式：`v1:<b64>,v2:<b64>`，最新 key 用于加密 |
| `WEBHOOK_HMAC_SECRET` | ✅ | — | webhook HMAC 签名密钥（出站 + 入站 inbox），≥ 16 字符 |
| `BASE_URL` | ❌ | `http://localhost:3000` | 用于出站 webhook 构造绝对 URL |
| `ADMIN_PASSWORD_HASH` | ✅ | — | bcrypt 哈希（admin 登录用） |
| `DATABASE_PATH` | ❌ | `./data/hunter.db` | SQLite 文件路径 |
| `PORT` | ❌ | `3000` | HTTP 监听端口 |
| `NODE_ENV` | ❌ | `development` | `development` / `test` / `production` |
| `RATE_LIMIT_ENABLED` | ❌ | `true` | `false` 关闭所有限流（仅本地开发） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | ❌ | — | 设置后 OTLP 上报到该 endpoint；否则 console exporter |
| `LOG_LEVEL` | ❌ | `info` | 暂未使用（log 走 console + x-trace-id） |

---

## 2. 加密密钥轮换

(保留 v1.4.1 文档原内容。生产环境从单 key 模式 (PLATFORM_ENCRYPTION_KEY) 切换到多 key
轮换 (PLATFORM_ENCRYPTION_KEYS) 是 forward-compatible 的：旧 key 仍在，新 key 用于
加密，部署期间允许解密任一 key 下的数据。)

---

## 3. 部署流程（生产 qing3.top / Linode）

### 3.1 拓扑

- 单一 Linode VM（`101.201.110.129`），系统 `5.10.134-18.al8.x86_64`。
- 服务在 `/opt/hunter-platform/`，由 `systemd` (`/etc/systemd/system/hunter-platform.service`) 管理。
- 入口：systemd → `node --experimental-sqlite --env-file=/opt/hunter-platform/.env /opt/hunter-platform/out/main/index.js`。
- 入口点历史：`src/main/index.ts` 在 R1.C2 期间改为 `src/main/server.ts` 暴露 `startApiServer()`，
  实际由 `index.js` 的底部 `void main().catch(...)` 触发。
- 通过 nginx 反代（`html_qing3.top`）对外服务，systemd 监听 `127.0.0.1:3000`。
- 部署无 git：`scp out/*` 同步。`/opt/hunter-platform/.git` 不存在。

### 3.2 标准部署（5 步）

```bash
# 1. local build
cd /d/dev/hunter-platform
rm -rf out tsconfig.node.tsbuildinfo     # 防止 .tsbuildinfo 缓存导致 telemetry.js 等被吞掉
pnpm install --frozen-lockfile
pnpm build

# 2. scp 整个 out/ 到生产（systemd 之前先停服，否则会丢请求）
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl stop hunter-platform'

# 3. 推送源码 + 配置文件（仅当配置/迁移有变化时需要）
#    a) 单文件源：scp src/main/db/migrations/vXXX.sql ...
#    b) 整树替换：tar 整个 src/ 然后 ssh 上 extract
#    c) 如果 lockfile / package.json 改了：
#       scp pnpm-lock.yaml package.json

# 4. 重启服务（systemd 自动重连）
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl start hunter-platform'

# 5. 验证
sleep 4
ssh -i /d/Downloads/cc.pem root@101.201.110.129 '
  systemctl status hunter-platform --no-pager --lines=3
  curl -sS http://localhost:3000/v1/health | head -c 80
'
```

### 3.3 R1.C2 部署特殊步骤（schema 跳号 + 重建 users 表）

> 这是 R1.C2 部署踩过的坑。其他大型 schema 升级可能复用同样模式。

```bash
# 在生产 DB 上：
ssh -i /d/Downloads/cc.pem root@101.201.110.129 '
DB=/opt/hunter-platform/data/hunter.db

# 1) 备份
sqlite3 "$DB" ".backup /opt/hunter-platform/data/hunter-pre-r1c2.db"

# 2) 检查是否有 legacy headhunter/employer 行（v029 之前 schema）
sqlite3 "$DB" "SELECT user_type, COUNT(*) FROM users GROUP BY user_type;"

# 3) 如果有 headhunter/employer，先在外部用 SQLite table-rebuild 技巧去除 CHECK
#    （SQLite 不能直接 DROP CHECK）。R1.C2 用的脚本（保存为参考）：
BEGIN;
CREATE TABLE users_nochk (
  id                       TEXT PRIMARY KEY,
  user_type                TEXT NOT NULL,    -- 故意去掉 CHECK
  name                     TEXT,
  contact                  TEXT,
  agent_endpoint           TEXT,
  api_key_hash             TEXT NOT NULL UNIQUE,
  api_key_prefix           TEXT NOT NULL,
  api_key_expires_at       TEXT,
  prev_api_key_hash        TEXT,
  prev_api_key_prefix      TEXT,
  prev_api_key_expires_at  TEXT,
  quota_per_day            INTEGER NOT NULL DEFAULT 100,
  quota_used               INTEGER NOT NULL DEFAULT 0,
  quota_reset_at           TEXT NOT NULL,
  reputation               INTEGER NOT NULL DEFAULT 50,
  status                   TEXT NOT NULL DEFAULT "active"
                              CHECK (status IN ("active", "suspended", "deleted")),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
INSERT INTO users_nochk SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_nochk RENAME TO users;
CREATE INDEX idx_users_api_key_hash ON users(api_key_hash);
CREATE INDEX idx_users_user_type ON users(user_type);

# 4) 重命名 legacy enum 值
UPDATE users SET user_type = "hr" WHERE user_type = "headhunter";
UPDATE users SET user_type = "pm" WHERE user_type = "employer";
COMMIT;

# 5) 然后再启动新代码（migration runner 会跑 v025-v031）
```

**为什么需要手动降级：**
- v029 把 `users.user_type` 的 CHECK 改为 `('candidate','hr','pm')`
- v031 试图 UPDATE legacy 行但 SQL 是 `WHERE user_type = 'hr' / 'pm'`（no-op，因为 legacy 是 headhunter/employer）
- 如果直接跑 v029/v031，v029 的 table-rebuild 会因为 `INSERT INTO users_new SELECT * FROM users` 在遇到 headhunter 行时失败（CHECK 拒绝）

### 3.4 R1.C3 部署步骤（webhook inbox v032）

无 schema 重建需求——v032 只是新建 `webhook_inbox_deliveries` 表（CREATE + UNIQUE 索引）。
直接 build + scp + restart 即可。验证：
```bash
TS=$(date +%s)
BODY='{"event":"deploy-test"}'
SIG=$(echo -n "${TS}.${BODY}" | openssl dgst -sha256 -hmac "${WEBHOOK_HMAC_SECRET}" -hex | awk '{print $2}')
curl -X POST https://qing3.top/v1/webhooks/qing3 \
  -H 'Content-Type: application/json' \
  -H "X-Hunter-Timestamp: $TS" \
  -H "X-Hunter-Signature: $SIG" \
  -d "$BODY"
# 期望：{"ok":true,"data":{"delivery_id":"wbin_...","deduped":false}}
# 再发一次：deduped=true，同 delivery_id
```

### 3.5 紧急回滚

R1 阶段（schema 跳号 + 大表 rebuild）的回滚比 v1.x 简单版本风险更高。
**建议：每次大型 deploy 前多保留一份 DB 备份（30 天滚动）。**

```bash
# 1) 停服
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl stop hunter-platform'

# 2) 还原 DB
ssh -i /d/Downloads/cc.pem root@101.201.110.129 '
  cd /opt/hunter-platform/data
  # 找最近的 pre-r1c2 备份
  cp hunter-pre-r1c2-*.db hunter.db    # 用 SQLITE 备份
  # 或：scp 旧 out/ 回滚到前一版本
'

# 3) 回滚代码
ssh -i /d/Downloads/cc.pem root@101.201.110.129 '
  cd /opt/hunter-platform
  rm -rf out && mv out.bak out 2>/dev/null
  # 或：scp 上一版本的 out/ 覆盖
'

# 4) 启动旧版本
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'systemctl start hunter-platform'
```

### 3.6 admin-web 部署

admin-web 是独立 SPA（React 18 + Vite），不是 node 服务：

```bash
# 1. local build
cd /d/dev/hunter-platform/admin-web
pnpm install --frozen-lockfile
pnpm build

# 2. scp dist/ 到 nginx 服务的静态文件目录
scp -r dist/* root@101.201.110.129:/var/www/html_qing3.top/

# 3. nginx reload（如果改了 nginx 配置）
ssh -i /d/Downloads/cc.pem root@101.201.110.129 'nginx -s reload'
```

注：R1.C2 时 admin-web 还没有完全集成到 nginx 反代（admin-web v1.5+ 在做）。具体路径以 nginx 配置为准。

---

## 4. 监控与健康检查

- 入口健康检查：`GET /v1/health` → `{"ok":true,"data":{"status":"healthy","timestamp":"..."}}`
- x-trace-id：所有响应都带 `x-trace-id: <32hex>` 头（W3C trace id）。
- metrics：`GET /metrics`（Prometheus 格式，路径无 /v1 前缀）。`GET /v1/metrics` 同义。
- 失败回执：所有错误响应都是 `{"ok":false,"error":{"code":"...","message":"..."}}` 格式，HTTP 状态码 4xx/5xx。
- Action history（审计）：`action_history` 表 + `GET /v1/admin/action-history?admin_id=&from=&until=` API。

## 5. 已知 operational gotchas

1. **tynpool/Windows IPC race（已 mitigate）**：
   单 fork 模式下未捕获 promise rejection 会让 worker 进程死掉，tinypool
   IPC 关闭，导致后续测试 silent skip。`tests/global-setup.ts` 现在 swallow
   `unhandledRejection` 和 `uncaughtException`（test-runtime only），log 到 stderr
   但不杀 worker。生产代码不受影响——global-setup 只在 vitest 下跑。
   详见 `docs/issues/2026-07-11-vitest-worker-crash-resolved.md`。

2. **legacy headhunter/employer 在旧 DB 上**：见 §3.3。

3. **首次 v031 部署需要 schema 重建**：R1.C2 在 production 上需要手动降级 user_type
   enum。v029 + v031 一起跑会失败（CHECK 拒绝 legacy 行）。

4. **.tsbuildinfo 缓存**：build 前 `rm -rf out tsconfig.node.tsbuildinfo` 防止
   telemetry.js 等被吞掉——已在 §3.2 第 1 步加入。

5. **build script copy .css**：scripts/copy-migrations.mjs 也 copy 所有 .css
   资产（不只是 migrations）。新增 .css 资源无需手动 scp。

6. **roleGate 中间件**：deploy 顺序——新代码 (含 roleGate) 上线后，错误的
   role 用户访问会立刻 403，verify 后再放行。

7. **node:sqlite 标志**：systemd 单元用 `--experimental-sqlite` 启动
   Node 22.11.0。这是 Node 22 默认 enable 的，但显式传 flag 让审计
   更容易看出依赖。

---

最后更新 2026-07-15。覆盖 R1.C2 (session auth + multi-role) + R1.C3
(webhook inbox dedup) + R1.C4 (capability aliases) + T10 (roleGate
全 4 个 role-restricted router) + a
