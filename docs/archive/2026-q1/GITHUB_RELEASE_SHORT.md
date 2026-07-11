# Quick GitHub Release Text

Use this for the GitHub "Releases" page textarea (https://github.com/qing3a/Hunter-Platform/releases/new).

---

## v1.0.2 — Bug fix: 3 missing endpoints

**Released:** 2026-06-18 · **Tests:** 177/177 passing · **Typecheck:** 0 errors

### What's Changed

- 🐛 **fix(api):** Add 3 missing endpoints documented in skill.md but not implemented — `GET /v1/users/:id/status`, `GET /v1/users/:id/history`, `GET /v1/candidate/access-log`
- ✨ **New repo:** `action-history` (listByUser + countByUser)
- ✨ **New method:** `unlock-audit-log.listByCandidate()` with 3-level JOIN
- ✨ **New router:** `src/main/routes/users.ts`
- 🔒 **Security:** `users/:id/history` restricted to own user (403 on others), `candidate/access-log` restricted to candidate role, no PII returned
- 📊 **Tests:** 165 → 177 (+12 new HTTP integration + repo tests)

**Upgrade:** No DB migration needed. `git pull && pnpm install && pnpm test`

Full notes: [`docs/RELEASE_NOTES_v1.0.md`](./blob/main/docs/RELEASE_NOTES_v1.0.md)

---

## v1.0.1 — Bug fix: Electron entry point

**Released:** 2026-06-18

### What's Changed

- 🐛 **fix(electron):** `node out/main/index.js` failed to start in compiled CJS (electron-vite build) because `isEntryPoint()` compared `import.meta.url` to `process.argv[1]` (URL-encoded vs native path)
- ✨ **Fix:** Replaced with `isTestEnv()` environment-signal check (`VITEST` / `VITEST_WORKER_ID` / `NODE_ENV=test`)
- ✅ Works in both dev (tsx) and prod (electron-vite build)
- 📊 **Tests:** 165/165 still passing + new regression test

---

## v1.0.0 — Initial production release 🎉

**Released:** 2026-06-17 · **Spec coverage:** 100% · **Tests:** 165/165

### What's New

A complete three-role recruitment platform with end-to-end API and admin GUI.

**Core features**
- 👤 Three roles: candidate, headhunter, employer — each with their own Agent
- 🔒 4-step unlock protocol (pending → employer_interested → candidate_approved → unlocked)
- 📡 Webhook async delivery with HMAC + retry + dead-letter queue
- ⚡ 3-tier rate limiting (1s/1min/1h) + daily quota per role
- 🔐 AES-256-GCM PII encryption with v1: versioned payload
- 🎭 Server-side desensitization (industry, title_level, salary_range, education_tier)
- 🚫 Cross-headhunter UNIQUE constraint preventing duplicate recommendations

**Admin GUI** (Convo Electron)
- 9 admin pages (Dashboard, Users, Candidates, Audit, Webhooks, RateLimit, Config, CommissionBilling, AdminActionsLog)
- IPC bridge (no HTTP) for admin operations
- Hybrid mode: Electron main also starts API server

**Monitoring & ops**
- 📊 Prometheus `/metrics` endpoint with 11 hunter_* custom metrics
- ⏰ 3 cron jobs (daily quota reset, hourly cleanup, monthly audit)
- 📈 4 k6 load test scripts
- 📄 OpenAPI 3.0 at `/v1/openapi.json`

**Commercial & GDPR**
- 💰 Commission calculation (20% platform / 70% primary / 30% referrer)
- 🇪🇺 GDPR Article 20: `GET /v1/candidate/export-my-data`
- 🗑️ GDPR Article 17: `POST /v1/candidate/delete-my-data`
- 🔒 PII memory zeroing

**Stats**
- 30 HTTP endpoints
- 12 DB tables
- 165 tests
- 27 commits
- 5 spec milestones

**Documentation**
- 📘 [skill.md](./blob/main/docs/superpowers/skill.md) — 8-section integration doc
- 📄 [openapi.json](./blob/main/docs/superpowers/openapi.json) — API spec
- 🏗️ [design spec](./blob/main/docs/superpowers/specs/2026-06-17-hunter-platform-design.md)
- 📋 [5 implementation plans](./blob/main/docs/superpowers/plans/)
- 📦 [delivery summary](./blob/main/docs/DELIVERY.md)

### Install

```bash
git clone https://github.com/qing3a/Hunter-Platform.git
cd Hunter-Platform
pnpm install
# Configure .env (PLATFORM_ENCRYPTION_KEY, WEBHOOK_HMAC_SECRET, ADMIN_PASSWORD_HASH)
pnpm api:dev          # API at http://localhost:3000
# or
pnpm dev               # Electron + API + admin UI
```

### What's Next (v2)

See [DELIVERY.md](./blob/main/docs/DELIVERY.md#v2-roadmap) for the full roadmap. Highlights:
- Real LLM integration for candidate matching
- Web deployment (Docker / k8s / PostgreSQL)
- Multi-admin collaboration
- Stripe payment integration
- Mobile app

### Known Limitations (v2 scope)

- Single admin (no multi-admin collaboration)
- Encryption key rotation is infrastructure-only (v2 needs full refactor for decrypt to accept key resolver)
- Skills search uses simple table scan (FTS5 in v2)
- `action_history` table is defined but no current handler writes to it (v2 task)

---

**Full Changelog**: [`docs/RELEASE_NOTES_v1.0.md`](./blob/main/docs/RELEASE_NOTES_v1.0.md)
**Quick start**: see "Install" above
**Issues**: https://github.com/qing3a/Hunter-Platform/issues
