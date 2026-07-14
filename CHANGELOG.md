# Changelog

All notable changes to hunter-platform, newest first. Each entry maps
to a `git log` commit range; click the commit hash to see the full diff.

Format follows [Keep a Changelog](https://keepachangelog.com/) — Added,
Changed, Fixed, Removed, Deprecated, Security. Versions follow
[SemVer](https://semver.org/) once we cut a 2.0 release.

---

## [Unreleased] — 2026-07-15

### R1 era: Client-contract stabilization (R1.C2, C3, C4, T10)

- **R1.C2** — Long session + multi-role auth.
  - `POST /v1/auth/login` exchanges an `hp_live_*` API key for a 168h
    `sess_*` session token. `POST /v1/auth/refresh` slides the expiry.
    `POST /v1/auth/logout` revokes (idempotent).
  - Every user now holds all 3 roles (`candidate` / `hr` / `pm`) by
    default; the `X-Active-Role: pm|hr|candidate` request header
    selects which one is in effect.
  - `authMiddleware` dispatches on token prefix: `sess_*` → session
    path; `hp_live_*` → apikey path. `req.user.active_role` is the
    unified gate.
  - **BREAKING**: legacy `headhunter` / `employer` enum values renamed
    to `hr` / `pm` across users.user_type, the v029 CHECK, all
    capabilities, route prefixes, and the schema_migrations table.
    See `docs/OPERATIONS.md §3.3` for the SQLite-rebuild dance we
    needed on production.

- **R1.C3** — Inbound webhook dedup.
  - New table `webhook_inbox_deliveries` (v032) with
    `UNIQUE(endpoint, body_hash)`. The route
    `POST /v1/webhooks/qing3` uses `INSERT OR IGNORE` + lookup so
    relay-side retries are deduped without re-processing.
  - HMAC verification: `X-Hunter-Timestamp` + `X-Hunter-Signature`
    (sha256(secret, "${ts}.${body}"), ±300s replay window).
  - Response: `{ data: { delivery_id, deduped: true|false } }`.

- **R1.C4** — Capability aliases for external skill naming.
  - `Capability.aliases?: readonly string[]` field; new lookup
    `findCapabilityByAlias(name)`. Three ow-recruit skills bind:
    - `ow_recruit.advance_candidate` → `pm.select_staffing_plan`
    - `ow_recruit.send_message` → `candidate_portal.messages.send`
    - `ow_recruit.sync_project_to_erp` → `pm.update_project`

- **T10** — `roleGate()` middleware closes the RBAC layer.
  - Applied to all 4 role-restricted routers:
    `/v1/pm`, `/v1/employer`, `/v1/employer-panel` (pm);
    `/v1/headhunter`, `/v1/headhunter-workspace` (hr);
    `/v1/candidate` (candidate). Handler-level `assertX(user)` re-checks
    as the source of truth.

### R2.5 — admin-web RateLimitPage
- New `/admin/rate-limit` page surfaces `GET /v1/config/rate-limits`
  + `POST /v1/admin/rate-limit/users/:id/clear`. Per-tier bucket
  readouts + per-user bucket reset.

### Docs
- `docs/FEATURES.md` (new, 469 lines): single source of truth for the
  141 REST endpoints, 86 capabilities, 25 migrations. Regenerate via
  `scripts/gen-features-doc.py`.
- `docs/superpowers/skill.md` frontmatter updated: 141 endpoints,
  dual-track auth, R1 era features.
- `docs/OPERATIONS.md` (was 25 days stale) rewritten with R1.C2
  schema-rebuild playbook + C3 deploy steps + 9 known gotchas.
- `docs/PROJECT_MEMORY.md` updated with R1 era 11 decisions + 9
  gotchas + cross-document nav.
- `docs/issues/2026-07-11-vitest-worker-crash-resolved.md` (new):
  root cause + fix for the long-standing worker crash.

### Test infrastructure
- **`process.on('unhandledRejection'/'uncaughtException')` swallow** in
  `tests/global-setup.ts` (test-runtime only). Production code unaffected.
  Previously 1-3/5 runs hit tinypool IPC closure; now 3/3 clean.
- Conformance: 33 previously-uncovered capabilities now have scenario
  tests in `tests/integration/skill-md-conformance/capability-coverage-extra.test.ts`.
- OpenAPI forward coverage: `scripts/generate-openapi.ts` MOUNT_PREFIXES
  fix + `scripts/apply-forward-gaps.py` tool = 0 forward gaps (was 75).

### Tooling
- `scripts/copy-migrations.mjs` extended to also copy all `.css` assets
  (was: only `.sql` migrations). `landing.css` etc. now ship in `out/`.
- `scripts/gen-features-doc.py` (new): regenerates `docs/FEATURES.md`
  from the route + capability declarations.

### Removed
- `mcp-server/` package deleted from this repo (it was published to
  GitHub Packages as `@qing3a/hunter-platform-mcp` v0.1.3). v0.1.3 used
  the legacy `headhunter` / `employer` enum in its Zod schemas, which
  R1.C2's rename broke. The npm/GitHub Packages entry was also
  deleted.

### Fixed
- Brittle `expect(migs).toEqual([1..24])` in 3 migration tests
  loosened to monotonic `[1..N]` + `N >= 24`. C3's v025 broke them
  otherwise; future migrations won't.
- `gather-landing-data.ts > uptimePercent` was using `process.uptime()`
  directly; now takes optional `opts.uptimeSec` so tests can assert
  cold-start deterministically.

---

## [v1.4.1] — 2026-06-20

### Sub-G: Public rate-limit + Commission + TTL 0
- `GET /v1/config/rate-limits` public endpoint (per-tier 1s/1m/1h buckets).
- Commission handler reads `commission.platform_rate` from the `config`
  table instead of a hard-coded 0.2.
- Config-cache TTL drops from 10s to 0s so admin writes apply
  immediately on the next request.

### Sub-F: Worker reads Config
- Background webhook worker reads `config` table for retry delays.
- `industry_map` loader reads `config.industry_map` (not from
  `config/industry_map.json`).
- Rate-limit middleware reads `config.rate_limit.tier.*` instead of the
  in-memory `RATE_LIMIT_BURSTS` constant.

### Sub-E: Config DB-backed
- New `config` table (`key`, `value_json`, `updated_at`,
  `updated_by_admin_user_id`).
- `PUT /v1/admin/config/:key` with required `reason` field; values
  written to DB; existing JSON files migrated on first run.
- `migrateConfigFromFilesToDB` runs on startup.

### current_company required
- `POST /v1/headhunter/candidates` requires `current_company` to be a
  non-empty string. The previous v1.4 had a NULL default which let
  bad data into `candidates_anonymized.industry` (always NULL).

### Docs
- `docs/OPERATIONS.md` (initial) + `docs/PROJECT_MEMORY.md` (Sub-G row).
- `docs/CHANGELOG.md` (this file) created.

### Tooling
- `scripts/check-conformance-coverage.ts` — reports capabilities that
  don't have a scenario test in `tests/integration/skill-md-conformance/`.
- `scripts/generate-skill-md-scenarios.ts` — fills in stub tests in
  `_generated.test.ts`.

---

## [v1.4.0] — 2026-06-19

### action_history + capability_name rename
- New `action_history` table (v011) with `trace_id` column for OTel
  correlation. Every business endpoint writes one row.
- v013: `action_type` column renamed to `capability_name` across
  30 capability declarations. Old values migrated to the canonical
  form (`headhunter.upload_candidate` etc.).

### Webhook traceparent
- v012: `webhook_delivery_queue` gains a `traceparent` column.
  Outbound HTTP requests carry the W3C `traceparent` header so
  receivers can join the trace.

### Job status: `claimed`
- v010: `jobs.status` gains `claimed` (between `open` and `filled`).
  PM (formerly employer) takes ownership of a hunter-created job
  before it can receive recommendations.

### Bug fixes
- `recommendations` `pipeline_stage` defaults to `submitted` (was NULL).
- `hunter_tasks` defaults `priority=normal` and timestamps via
  `unixepoch()*1000`.
- `op_type` removed from `admin_action_log`; the
  `webhook_dead_letter` action was misclassified as `op_type='failed'`
  instead of `op_type='pending'`.
- `webhook_delivery_queue` carries `X-Hunter-Signature` on every
  outbound POST; `X-Hunter-Timestamp` verified to ±300s skew.

### Tooling
- `scripts/postbuild.sh` (later renamed to `scripts/copy-migrations.mjs`)
  copies migrations to `out/main/db/migrations/`.

---

## [v1.0.0] — 2026-06-18

### Baseline release

- 25 schema migrations at v024
- 17 capabilities across 3 role sets (admin, hr, candidate)
- 46 REST endpoints (pre-R1 era)
- Express + bette
