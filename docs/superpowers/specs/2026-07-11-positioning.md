# Hunter Platform Positioning Spec

**Status**: Active
**Date**: 2026-07-11
**Author**: Self (single maintainer)
**Supersedes**: implicit positioning from `README.md` (v1.8.0) + scattered plan files
**Related**: `2026-07-01-product-positioning-standard.md` (value-proposition layer)

---

## 1. One-line positioning

**Hunter Platform is the API + platform-management backend for an Agent-mediated headhunter marketplace. PM/HR/Candidate UIs are owned by external clients, not us.**

---

## 2. What we ARE

### 2.1 Technical artifact
- **Backend HTTP API** (Node.js + Express + SQLite + Zod, 22 modules in `src/main/`)
- **Platform-management web console** (`admin-web/`, React 18 + Vite, 19 pages)
- **Shared utility library** (`shared-web/`, React-free utilities for any client)
- **Public contracts**:
  - OpenAPI 3.0 spec (`GET /v1/openapi.json`)
  - Agent skill doc (`GET /v1/skill.md`)
  - Capability self-description (`GET /v1/capabilities`)

### 2.2 What we do for clients
- **Multi-role auth** — one user can hold pm/hr/candidate roles; session-token + `X-Active-Role` (planned C2)
- **Domain logic** — projects, positions, candidates, recommendations, placements, commission splits
- **Quota + rate-limit** — fair-use enforcement per role
- **Audit + action history** — every mutation logged with actor + trace
- **Webhook delivery** — outbound to client `agent_endpoint` (HMAC-signed, retry-with-backoff, dead-letter)
- **Real-time events** — WebSocket fan-out for application stage changes, new messages, quota warnings
- **Admin operations** — user management, role assignment, key rotation, dead-letter inspection

### 2.3 Value proposition (from product-positioning-standard.md)

> **找得到人 → 推得出去 → 跟得住过程 → 算得清业绩**

Any feature description, landing hero, or client-facing doc should map to one of these four stages.

---

## 3. What we AREN'T (explicit non-goals)

| We don't build | Why |
|---|---|
| PM/HR/Candidate-facing web UI | ow-recruit (`C:\Users\Administrator\Desktop\ow-headhunter-sass`) owns it — 9948-line prototype.html covers all 9 PM screens + hunter + candidate portals |
| Mobile app | Out of scope; web clients handle mobile via responsive design |
| Email/SMS delivery | Outbound webhook is the contract; clients integrate Twilio/SendGrid as needed |
| Resume parsing / NER | Out of scope; clients can call external services and post structured data via `POST /v1/candidate/upload` |
| Job board crawler | Out of scope; jobs enter via `POST /v1/jobs` (manual, by HR/PM) or webhook from external ATS |
| Payment processing | We track commission splits; actual payout is between clients |
| Mobile app (native) | Out of scope for **this repo**. If demand emerges, build as a separate client repo (similar to how ow-recruit is separate). Web clients handle mobile via responsive design. |
| Multi-tenancy | Single-tenant per deployment (M1-onwards was always this) |

---

## 4. Client ecosystem

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌──────────────────────────┐         ┌──────────────────────────┐ │
│  │  External clients        │         │  Platform management     │ │
│  │  (any HTTP-speaking AI   │         │  (humans / ops AI)       │ │
│  │   or web app)            │         │                          │ │
│  │                          │         │  ┌────────────────────┐  │ │
│  │  ┌────────────────────┐  │  HTTP   │  │  admin-web         │  │ │
│  │  │  ow-recruit        │  │ ──────► │  │  (this repo)       │  │ │
│  │  │  (reference impl)  │  │         │  └────────────────────┘  │ │
│  │  │  9948-line SPA     │  │ ◄────── │           │              │ │
│  │  │  PM/HR/Cand UI     │  │  hooks  │           ▼              │ │
│  │  └────────────────────┘  │         │  ┌────────────────────┐  │ │
│  │                          │         │  │  src/main/ (API)   │  │ │
│  │  ┌────────────────────┐  │         │  │  (this repo)       │  │ │
│  │  │  future client A   │  │         │  │  22 modules        │  │ │
│  │  │  (mobile, web, etc)│  │         │  └────────────────────┘  │ │
│  │  └────────────────────┘  │         │           │              │ │
│  │                          │         │           ▼              │ │
│  │  ┌────────────────────┐  │         │  ┌────────────────────┐  │ │
│  │  │  future client B   │  │         │  │  shared-web        │  │ │
│  │  │  (e.g. CLI agent)  │  │         │  │  (utilities)       │  │ │
│  │  └────────────────────┘  │         │  └────────────────────┘  │ │
│  │                          │         │                          │ │
│  └──────────────────────────┘         └──────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 Reference client: ow-recruit

`C:\Users\Administrator\Desktop\ow-headhunter-sass` (a.k.a. ow-recruit) is a **sister-project client implementation** that:

- Provides the PM/HR/Candidate SPA (single-file 9948-line `prototype.html`)
- Has its own relay + SQLite for offline-mode operation
- Optionally connects to hunter-platform via webhook (`POST /v1/webhooks/qing3` planned C3)
- Implements the exact webhook contract we documented (X-Hunter-Signature, ±5min replay, body-hash dedup)

We treat ow-recruit's `prototype.html` as the **de-facto UI specification** for what a hunter-platform client looks like. If we add a new capability, it should be consumable by ow-recruit's existing patterns.

### 4.2 Contract stability promise

We commit to **backwards-compatible API evolution** within a major version (v1.x):
- New endpoints: additive, safe
- New optional fields in responses: safe
- Removing endpoints / changing response shape: major version bump + 6-month deprecation window
- Webhook signature format: frozen (SHA-256 HMAC, X-Hunter-* headers, ±5min replay)

---

## 5. Architecture (current state, post 2026-07-11 cleanup)

```
hunter-platform/                      ← this repo
├── admin-web/         ← platform-management SPA (humans)
│   ├── 19 pages       (Users / Jobs / Audit / Webhook / Recommendations / etc.)
│   └── 1 e2e + 217 unit tests
├── shared-web/        ← utilities (no React Router, no DOM API)
│   ├── format, mask, toast
│   └── styles (stub for cross-SPA tokens)
├── src/main/          ← backend API
│   ├── 22 modules     (admin / auth / candidate / commission / notification / pm /
│   │                   headhunter / employer / webhook / quota / rate-limit / cron / etc.)
│   ├── 30 SQL migrations
│   └── 875 tests across workspace
├── tsconfig.json      ← 4-project references (tsc --build)
├── pnpm-workspace.yaml ← 2 packages (admin-web + shared-web)
└── docs/superpowers/  ← all planning artifacts
```

**Workspace is 2 packages, not 5 or 1.** The 5-SPA experiment is over.

---

## 6. Roadmap (next 3 phases)

### Phase R1: Client-contract stabilization (2-3 weeks)

Goal: ensure ow-recruit (and any future client) can fully integrate.

| Task | Priority | Status |
|---|---|---|
| **C2.** Session token + `X-Active-Role` + `user_role` multi-role table | 🔴 P0 | not started |
| **C3.** Webhook inbox dedup + `POST /v1/webhooks/qing3` | 🔴 P0 | not started |
| **C4.** Skill naming alignment (3 ow-recruit skills: `advance-candidate`, `send-message`, `sync-project-to-erp`) | 🟡 P1 | not started |
| OpenAPI: regenerate + check into git | 🟡 P1 | partial |
| `capabilities` endpoint: ensure response matches what ow-recruit expects | 🟡 P1 | partial |

### Phase R2: Operational maturity (2-4 weeks)

Goal: production-ready single-tenant deployment.

| Task | Priority | Status |
|---|---|---|
| OpenTelemetry trace propagation end-to-end (admin → backend → webhook) | 🟡 P1 | partial |
| Webhook dead-letter admin UI polish (currently `WebhookDeadLetterPage`) | 🟡 P1 | exists, basic |
| Commission calculator coverage (currently `src/main/modules/commission/`) | 🟡 P1 | exists, needs more scenarios |
| Notification system end-to-end test (currently `notification/` module) | 🟡 P1 | partial |
| Rate-limit + quota dashboard in admin-web | 🟢 P2 | not started |
| Structured logging correlation IDs | 🟢 P2 | partial |

### Phase R3: Ecosystem expansion (1-2 months)

Goal: enable a second client implementation; validate that the API is general-purpose.

| Task | Priority | Status |
|---|---|---|
| Document the full integration recipe (auth → discover → call → react to events) | 🟡 P1 | partial (skill.md) |
| Add a second reference client (CLI agent or web client in **separate repo**) to validate API generality | 🟢 P2 | not started |
| Capability registry consolidation (single source of truth for action names) | 🟢 P2 | partial |
| Public landing page update to reflect new positioning | 🟡 P1 | current landing is B2C-focused, may need pivot |

---

## 7. Decision log (this spec)

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-11 | Remove `app-web/` entirely | Empty skeleton after portal cut; no value, increases maintenance surface |
| 2026-07-11 | Cut portal redundancy (`c41167d`) | ow-recruit already provides PM/HR/Candidate UI; we were duplicating |
| 2026-07-11 | Stop building user-facing UIs in this repo | API + admin only; clients own user-facing UI |
| 2026-07-11 | Treat ow-recruit as de-facto UI spec | It's the only working client; reverse-engineering yields the real contract |
| 2026-07-10 | Pivot 5-SPA → 2-SPA | One user holding multiple roles is auth state, not deployment topology |
| 2026-07-01 | Value prop: "找得到人 → 推得出去 → 跟得住过程 → 算得清业绩" | Single sentence describing all platform work |
| 2026-06-18 | Reposition to API-first | Stop building Electron/desktop; expose HTTP only |

---

## 8. Anti-patterns (what we will NOT do again)

| Anti-pattern | Lesson learned |
|---|---|
| Build UI in same repo as backend | Drift, bloat, conflicting deployment cycles; clients want different stacks |
| Trust plan files as ground truth | Plans get archived/superseded; only spec files + code tell current truth |
| Multi-SPA architecture "for cleanliness" | Premature splitting; a single SPA with role-switching is the right model for one-user-many-roles |
| Frontend portals duplicating client UI | ow-recruit exists; building the same UI twice is waste |
| Orphan CSS files left in repo after portal removal | Phase 4 left 5522 lines of dead `*-portal.css`; caught in cut-portal-redundancy audit |

---

## 9. Open questions

1. **App-web revival as "reference client skeleton"?** Current decision: no. If we need a reference client later, we can rebuild from scratch with current standards rather than inherit Phase 4.5 baggage.
2. **Mobile client?** Out of scope. If demand emerges, build a separate client (new repo).
3. **Multi-tenancy?** Single-tenant per deployment. If multi-tenant demand emerges, that's a v3 architectural rethink, not a feature add.
4. **Data residency / GDPR delete semantics?** Currently `POST /v1/candidate/delete-my-data` anonymizes PII but keeps aggregate stats. Confirm this matches regulatory requirements before going to production.

---

## 10. References

- `README.md` — operational guide (dev / build / test commands)
- `docs/superpowers/specs/2026-07-01-product-positioning-standard.md` — value proposition layer
- `docs/superpowers/specs/2026-06-18-reposition-to-api-first-design.md` — historical API-first rationale
- `docs/superpowers/plans/2026-07-11-cut-portal-redundancy.md` — the cut plan that produced the new architecture
- `docs/superpowers/plans/2026-07-10-five-spa-split.md` (ARCHIVED) — the 5-SPA experiment
- `C:\Users\Administrator\Desktop\ow-headhunter-sass\prototype.html` — the reference PM/HR/Candidate UI implementation