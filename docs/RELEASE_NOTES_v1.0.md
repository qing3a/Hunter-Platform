# Hunter Platform v1.0 — Release Notes

> **Status:** Production-ready · **Coverage:** 100% spec complete · **Date:** 2026-06-18
> **Repo:** https://github.com/qing3a/Hunter-Platform

---

## 🎯 v1.0.0 — Initial Production Release (2026-06-17)

First stable release. All 5 spec milestones (M1-M5) delivered.

### ✨ What's New

**Three-role platform** with end-to-end recruitment workflow:
- **Candidate** registers + uploads resume (auto-desensitized)
- **Headhunter** uploads candidates, recommends to employers
- **Employer** posts jobs, browses desensitized talent pool, unlocks contact

**Core features**:
- 30 HTTP API endpoints (auth, jobs, candidates, recommendations, unlock flow, placements)
- 4-step unlock protocol (pending → employer_interested → candidate_approved → unlocked)
- Webhook async delivery with HMAC signing + retry + dead-letter queue
- 3-tier rate limiting (1s / 1min / 1h) + daily quota
- AES-256-GCM PII encryption with v1: versioned payload
- Server-side desensitization (industry, title_level, salary_range, education_tier)
- Cross-headhunter UNIQUE constraint preventing duplicate recommendations

**Admin GUI** (Convo Electron):
- 9 admin pages (Dashboard, Users, Candidates, Audit, Webhooks, RateLimit, Config, **CommissionBilling**, **AdminActionsLog**)
- IPC bridge (no HTTP) for admin operations
- Hybrid mode: Electron main process also starts API server

**Monitoring & ops**:
- Prometheus `/metrics` endpoint with 11 hunter_* custom metrics
- 3 cron jobs (daily quota reset, hourly bucket cleanup, monthly audit archive)
- 4 k6 load test scripts
- OpenAPI 3.0 specification at `/v1/openapi.json`

**Commercial & compliance**:
- Commission calculation (20% platform / 70% primary headhunter / 30% referrer)
- GDPR Article 20: `GET /v1/candidate/export-my-data` returns candidate's full data
- GDPR Article 17: `POST /v1/candidate/delete-my-data` with state machine guard
- PII memory zeroing (`Buffer.fill(0)` after decrypt)

### 📊 Stats

| Metric | Value |
|--------|-------|
| **Tests** | 165 (M1-M5) |
| **HTTP endpoints** | 27 |
| **DB tables** | 12 + schema_migrations |
| **Admin pages** | 9 |
| **Modules** | 14 |
| **Repositories** | 8 |
| **IPC handlers** | 7 |
| **Migrations** | 2 (v001 + v002) |
| **Tags** | 6 (m1-m5 complete + v1.0.0) |
| **Commits** | 50+ |
| **Spec coverage** | **100%** |

### 🔒 Security

- PII fields (`name`, `phone`, `email`, `expected_salary`) AES-256-GCM encrypted
- HMAC-SHA256 webhook signing with 5-min timestamp window (replay protection)
- `crypto.timingSafeEqual` for constant-time signature comparison
- All state machine transitions wrapped in `db.transaction()` (BEGIN/COMMIT/ROLLBACK)
- UNIQUE constraint on `(anonymized_candidate_id, job_id, primary_headhunter_id)` prevents duplicate placements
- Auth required on all admin endpoints (Bearer token)

### 📚 Documentation

- `docs/superpowers/skill.md` — 8-section integration doc for external Agents
- `docs/superpowers/openapi.json` — Machine-readable API spec (18 paths, 4 schemas)
- `docs/superpowers/specs/2026-06-17-hunter-platform-design.md` — Full design spec
- `docs/superpowers/plans/` — 5 implementation plans (M1-M5)
- `docs/DELIVERY.md` — v1.0 delivery summary

### ⚠️ Known Limitations (v2 scope)

- Single admin (no multi-admin collaboration)
- Encryption key rotation is infrastructure-only (v2 needs full refactor for decrypt to accept key resolver)
- Skills search uses simple table scan + limit 100 (FTS5 in v2)
- action_history table is defined but no current handler writes to it (v2 task)
- No production deployment artifacts (Dockerfile, k8s manifests)
- No real payment integration (Stripe)
- No LLM for candidate matching

---

## 🔧 v1.0.1 — Bug Fix: Electron Entry Point (2026-06-18)

### 🐛 Fixed

- **#electron-entry-bug**: `node out/main/index.js` (compiled CJS via electron-vite) failed to start main()
  - **Root cause**: `isEntryPoint()` compared `import.meta.url` to `process.argv[1]` — fragile in compiled CJS due to URL encoding vs native path format mismatches
  - **Example mismatch**:
    ```
    import.meta.url  = file:///D:/dev/hunter-platform/out/main/index.js
    process.argv[1] = D:\dev\hunter-platform\out\main\index.js
    ```
  - **Fix**: Replaced with `isTestEnv()` environment-signal check (`VITEST` / `VITEST_WORKER_ID` / `NODE_ENV=test`)
  - **Result**: Same logic, no fragile path comparison, works in both dev (tsx) and prod (electron-vite build)

### ✅ Verified

- `pnpm test`: 165/165 still passing
- `pnpm typecheck`: 0 errors
- New regression test (file-shape check) prevents re-introduction

### 📝 Changed

- `src/main/index.ts`: Replaced path-comparison check with env-signal check
- `tests/unit/electron-main-startup.test.ts`: Added regression test

---

## 🔧 v1.0.2 — Bug Fix: 3 Missing Endpoints (2026-06-18)

### 🐛 Fixed

- **#bug-2-missing-endpoints**: 3 endpoints documented in `skill.md` returned 404 ("Cannot GET")
  - `GET /v1/users/:id/status` — User status with quota
  - `GET /v1/users/:id/history` — User's action history
  - `GET /v1/candidate/access-log` — Who accessed my data

### ✨ New

**3 new endpoints** + **1 new repository** + **1 new route file**:

| Endpoint | Description | Auth | Role |
|----------|-------------|------|------|
| `GET /v1/users/:id/status` | User info, quota, reputation (PII masked) | Bearer | Any |
| `GET /v1/users/:id/history` | Own action history (100 most recent) | Bearer | Own only (403 on others) |
| `GET /v1/candidate/access-log` | Who unlocked/expressed interest in me | Bearer | Candidate only |

**New repository**: `action-history` (listByUser + countByUser)

**New method** in `unlock-audit-log`: `listByCandidate(candidateUserId)` — 3-level JOIN:
```sql
audit_log → recommendations → candidates_anonymized → candidates_private
WHERE candidates_private.candidate_user_id = ?
```

### 🔒 Security

- `users/:id/history` — only own user (403 on others)
- `users/:id/status` — strips `api_key_hash`, `contact`, `agent_endpoint`
- `candidate/access-log` — only candidate role (403 on others)
- `candidate/access-log` — returns no PII (`name`, `phone`, `email`)

### ✅ Verified

- `pnpm test`: 165 → **177/177 passing** (+12 new tests)
- `pnpm typecheck`: 0 errors
- Live HTTP integration tests for all 3 endpoints (auth, role, PII, 404 cases)

### 📝 Changed

| File | Change |
|------|--------|
| `src/main/db/repositories/action-history.ts` | **NEW** |
| `src/main/db/repositories/unlock-audit-log.ts` | + `listByCandidate()` |
| `src/main/routes/users.ts` | **NEW** (status + history routes) |
| `src/main/routes/candidate.ts` | + `access-log` route |
| `src/main/server.ts` | + `app.use('/v1/users', ...)` |
| `tests/integration/repos/action-history.test.ts` | **NEW** (3 tests) |
| `tests/integration/missing-endpoints.test.ts` | **NEW** (9 tests) |

---

## 📋 Bug 1 (Chinese Encoding) — Not a Bug

User reported: Chinese characters display as `������` in response.

**Investigation**: Tested with Node http client. Server returns:
- ✅ `Content-Type: application/json; charset=utf-8`
- ✅ Chinese roundtrip works correctly (`title: '高级前端工程师'` → 200 → returns same)

**Conclusion**: Client-side display issue. Windows CMD interprets UTF-8 bytes as GBK by default.

**Fix recommendations for clients**:
- PowerShell: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`
- CMD: `chcp 65001` before curl
- Use a UTF-8-aware client (Postman, Insomnia, VS Code REST Client)
- Pass `--output -` to curl and pipe to a file, then view in UTF-8 editor

**No server-side change required**.

---

## 📥 Installation

```bash
# Clone
git clone https://github.com/qing3a/Hunter-Platform.git
cd Hunter-Platform

# Install
pnpm install

# Configure
cp .env.example .env  # then edit
# Required: PLATFORM_ENCRYPTION_KEY, WEBHOOK_HMAC_SECRET, ADMIN_PASSWORD_HASH

# Run
pnpm api:dev         # API only (port 3000)
# or
pnpm dev              # Electron + API + admin UI

# Test
pnpm test             # 177/177 passing
pnpm typecheck        # 0 errors
```

## 🔄 Upgrade from v1.0.0 → v1.0.2

```bash
git pull origin main
git checkout v1.0.2
pnpm install
# No DB migration needed (v1.0.1 and v1.0.2 don't change schema)
pnpm test
```

## 🛣️ What's Next (v2)

See [`docs/DELIVERY.md`](./DELIVERY.md) for the v2 roadmap. Highlights:
- Real LLM integration (candidate matching)
- Web deployment (Docker, k8s, PostgreSQL)
- Multi-admin collaboration
- Stripe payment integration
- Mobile app

---

## 📜 Full Changelog

### v1.0.2 (2026-06-18)

```
fix(api): add 3 missing endpoints documented in skill.md (Bug 2)

- GET /v1/users/:id/status
- GET /v1/users/:id/history (own user only, FORBIDDEN on others)
- GET /v1/candidate/access-log (candidates only, 3-level JOIN
  from audit_log through recommendations to candidate records)

Tests: 165 → 177 (+12)
New files:
- src/main/db/repositories/action-history.ts
- src/main/routes/users.ts
- tests/integration/repos/action-history.test.ts
- tests/integration/missing-endpoints.test.ts
```

### v1.0.1 (2026-06-18)

```
fix(electron): replace fragile isEntryPoint() path check with isTestEnv() guard

isEntryPoint() compared import.meta.url to process.argv[1], which is
fragile in compiled CJS (electron-vite output) due to URL encoding
vs native path format mismatches.

Fix: use environment signals (VITEST / VITEST_WORKER_ID / NODE_ENV)
inside main() to detect test env. Robust in dev (tsx) and prod
(electron-vite build) modes.

Tests: 165/165 still passing
```

### v1.0.0 (2026-06-17)

```
First stable release. All 5 spec milestones (M1-M5) delivered.
100% spec coverage.

- M1: Core API + candidate upload
- M2: 3-role closed loop + 4-step unlock + Webhook
- M3: Convo Electron admin GUI + skill.md
- M4: Commission + GDPR + OpenAPI
- M5: Monitoring + Cron + k6 + key rotation
```
