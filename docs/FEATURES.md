# Hunter Platform - Features Reference

> Single source of truth for what the platform exposes. Counts are
> 141 REST endpoints and 86 declared capabilities (R1.C2 + R1.C3 + R1.C4 +
> T10 close, deployed on qing3.top). Backed by 25 schema migrations.
>
> Last updated 2026-07-15. Generated from src/main/routes/*.ts and
> src/main/capabilities/*.ts. Regenerate via python3 scripts/gen-features-doc.py.

---

## 1. Top-level architecture

Two deployment targets: this Node.js API (prod qing3.top via Linode) and
the admin-web (React 18 + Vite, served as static SPA). All interaction is
plain HTTP/JSON; there is no desktop client, no IPC, no proprietary protocol.

Routes: 141 endpoints across 15 router files.
Capabilities: 86 declared (8 role sets).
Schema: 25 migrations applied on prod.

---

## 2. REST endpoints by router

Total: 141 endpoints across 15 router files. Mount prefixes reflect
how the server in src/main/server.ts attaches them.

### src/main/routes/admin.ts  (32 endpoints)

| Method | Path |
|---|---|
| POST | `/auth/login` |
| POST | `/auth/rotate-key` |
| GET | `/me` |
| GET | `/ping` |
| GET | `/dashboard/stats` |
| GET | `/users` |
| POST | `/users/:id/suspend` |
| POST | `/users/:id/unsuspend` |
| POST | `/users/:id/adjust-quota` |
| GET | `/candidates` |
| POST | `/candidates/:id/remove-from-pool` |
| GET | `/audit` |
| GET | `/action-history` |
| GET | `/users/:id` |
| GET | `/jobs/:id` |
| GET | `/candidates/:id` |
| GET | `/recommendations/:id` |
| GET | `/webhooks/dead-letter` |
| POST | `/webhooks/:id/retry` |
| GET | `/rate-limit/buckets` |
| POST | `/rate-limit/users/:id/clear` |
| GET | `/config` |
| PUT | `/config/:key` |
| GET | `/jobs` |
| GET | `/recommendations` |
| GET | `/placements` |
| POST | `/placements/:id/mark-paid` |
| POST | `/placements/:id/cancel` |
| GET | `/placements/summary` |
| GET | `/admin-log` |
| GET | `/timeline/:type/:id` |
| GET | `/login-events` |

### src/main/routes/auth.ts  (5 endpoints)

| Method | Path |
|---|---|
| POST | `/register` |
| POST | `/login` |
| POST | `/refresh` |
| POST | `/logout` |
| POST | `/rotate-key` |

### src/main/routes/candidate-portal.ts  (13 endpoints)

| Method | Path |
|---|---|
| POST | `/auth/otp/request` |
| GET | `/jobs/browse` |
| GET | `/jobs/recommended` |
| GET | `/jobs/:id` |
| POST | `/jobs/:id/apply` |
| GET | `/applications` |
| GET | `/applications/:id` |
| POST | `/applications/:id/respond` |
| GET | `/profile` |
| PUT | `/profile` |
| GET | `/profile/audit-log` |
| GET | `/messages` |
| POST | `/messages` |

### src/main/routes/candidate.ts  (6 endpoints)

| Method | Path |
|---|---|
| GET | `/opportunities` |
| GET | `/access-log` |
| GET | `/export-my-data` |
| POST | `/recommendations/:id/approve-unlock` |
| POST | `/recommendations/:id/reject-unlock` |
| POST | `/delete-my-data` |

### src/main/routes/capabilities.ts  (2 endpoints)

| Method | Path |
|---|---|
| GET | `/v1/capabilities` |
| GET | `/v1/capabilities/me` |

### src/main/routes/config.ts  (4 endpoints)

| Method | Path |
|---|---|
| GET | `/industries` |
| GET | `/title_levels` |
| GET | `/salary_bands` |
| GET | `/rate-limits` |

### src/main/routes/employer-panel.ts  (1 endpoints)

| Method | Path |
|---|---|
| GET | `/dashboard` |

### src/main/routes/employer.ts  (17 endpoints)

| Method | Path |
|---|---|
| POST | `/placements` |
| GET | `/placements` |
| POST | `/jobs` |
| GET | `/jobs` |
| GET | `/talent` |
| POST | `/recommendations/:id/express-interest` |
| POST | `/recommendations/:id/unlock-contact` |
| GET | `/pending-claims` |
| POST | `/pending-claims/:id/claim` |
| POST | `/pending-claims/:id/reject` |
| POST | `/claim-jobs/:id` |
| POST | `/reject-jobs/:id` |
| GET | `/jobs/:id` |
| PATCH | `/jobs/:id` |
| POST | `/jobs/:id/pause` |
| POST | `/jobs/:id/resume` |
| POST | `/jobs/:id/close` |

### src/main/routes/headhunter-workspace.ts  (12 endpoints)

| Method | Path |
|---|---|
| GET | `/dashboard` |
| GET | `/tasks` |
| POST | `/tasks` |
| PUT | `/tasks/:id` |
| DELETE | `/tasks/:id` |
| POST | `/tasks/:id/complete` |
| POST | `/tasks/:id/reopen` |
| GET | `/kanban` |
| POST | `/kanban/move` |
| POST | `/kanban/add` |
| POST | `/kanban/remove` |
| GET | `/stats` |

### src/main/routes/headhunter.ts  (10 endpoints)

| Method | Path |
|---|---|
| POST | `/candidates` |
| POST | `/recommendations` |
| POST | `/recommendations/:id/withdraw` |
| POST | `/candidates/:id/publish-to-pool` |
| GET | `/recommendations` |
| GET | `/candidates` |
| POST | `/jobs` |
| GET | `/jobs` |
| GET | `/recommendations/pending-pickup` |
| POST | `/recommendations/:id/pickup` |

### src/main/routes/landing.ts  (1 endpoints)

| Method | Path |
|---|---|
| GET | `/` |

### src/main/routes/market.ts  (2 endpoints)

| Method | Path |
|---|---|
| GET | `/leaderboard` |
| GET | `/jobs` |

### src/main/routes/notifications.ts  (5 endpoints)

| Method | Path |
|---|---|
| GET | `/` |
| GET | `/:id` |
| POST | `/:id/read` |
| POST | `/read-all` |
| DELETE | `/:id` |

### src/main/routes/pm.ts  (28 endpoints)

| Method | Path |
|---|---|
| POST | `/projects` |
| GET | `/projects` |
| GET | `/projects/:id` |
| PATCH | `/projects/:id` |
| DELETE | `/projects/:id` |
| POST | `/projects/:projectId/positions` |
| GET | `/projects/:projectId/positions` |
| GET | `/projects/:projectId/positions/stats` |
| POST | `/projects/:projectId/positions/bulk` |
| GET | `/positions/:id` |
| PATCH | `/positions/:id` |
| DELETE | `/positions/:id` |
| POST | `/projects/:projectId/decompose` |
| POST | `/projects/:projectId/decompose/:decompositionId/commit` |
| GET | `/projects/:projectId/decompositions` |
| POST | `/projects/:projectId/plans` |
| GET | `/projects/:projectId/plans` |
| GET | `/plans/:id` |
| PATCH | `/plans/:id` |
| DELETE | `/plans/:id` |
| POST | `/plans/:id/select` |
| GET | `/positions/:id/sandbox` |
| GET | `/positions/:id/matches` |
| POST | `/positions/:id/matches/recompute` |
| GET | `/snapshot` |
| GET | `/notes/:candidate_user_id` |
| PUT | `/notes/:candidate_user_id` |
| GET | `/notes` |

### src/main/routes/users.ts  (2 endpoints)

| Method | Path |
|---|---|
| GET | `/:id/status` |
| GET | `/:id/history` |

### src/main/routes/webhooks-inbox.ts  (1 endpoints)

| Method | Path |
|---|---|
| POST | `/qing3` |

Total: 141 endpoints.

---

## 3. Declared capabilities by role

Capabilities are the typed contract. Each maps to a route + method,
resolved at request time by the capability-resolver middleware.
Total: 86 capabilities across 8 role sets.

### Role `admin`  (22 capabilities, src/main/capabilities/admin.ts)

- `admin.ping`
- `admin.dashboard_stats`
- `admin.list_users`
- `admin.suspend_user`
- `admin.unsuspend_user`
- `admin.adjust_user_quota`
- `admin.list_candidates`
- `admin.remove_from_pool`
- `admin.audit_log`
- `admin.webhook_dead_letter`
- `admin.retry_webhook`
- `admin.get_config`
- `admin.put_config`
- `admin.list_placements`
- `admin.mark_placement_paid`
- `admin.cancel_placement`
- `admin.placements_summary`
- `admin.admin_log`
- `admin.list_jobs`
- `admin.list_recommendations`
- `admin.get_timeline`
- `admin.list_dead_letter`

### Role `auth`  (2 capabilities, src/main/capabilities/auth.ts)

- `auth.register`
- `auth.rotate_key`

### Role `candidate`  (12 capabilities, src/main/capabilities/candidate-portal.ts)

- `candidate_portal.auth.request_otp`
- `candidate_portal.auth.verify_otp`
- `candidate_portal.jobs.browse`
- `candidate_portal.jobs.view`
- `candidate_portal.jobs.apply`
- `candidate_portal.applications.list`
- `candidate_portal.applications.respond`
- `candidate_portal.messages.send`
- `candidate_portal.messages.list`
- `candidate_portal.profile.view`
- `candidate_portal.profile.edit_public`
- `candidate_portal.profile.view_audit`

### Role `candidate`  (6 capabilities, src/main/capabilities/candidate.ts)

- `candidate.view_opportunities`
- `candidate.access_log`
- `candidate.export_my_data`
- `candidate.approve_unlock`
- `candidate.reject_unlock`
- `candidate.delete_my_data`

### Role `pm`  (10 capabilities, src/main/capabilities/employer.ts)

- `employer.create_placement`
- `employer.list_placements`
- `employer.create_job`
- `employer.list_jobs`
- `employer.browse_talent`
- `employer.express_interest`
- `employer.unlock_contact`
- `employer.list_pending_claims`
- `employer.claim_job`
- `employer.reject_job`

### Role `hr`  (10 capabilities, src/main/capabilities/headhunter.ts)

- `headhunter.upload_candidate`
- `headhunter.recommend_candidate`
- `headhunter.recommendations.list_pending_pickup`
- `headhunter.recommendations.pickup`
- `headhunter.withdraw_recommendation`
- `headhunter.publish_to_pool`
- `headhunter.list_recommendations`
- `headhunter.list_candidates`
- `headhunter.create_job`
- `headhunter.list_jobs`

### Role `auth`  (5 capabilities, src/main/capabilities/notifications.ts)

- `notifications.list`
- `notifications.get`
- `notifications.mark_read`
- `notifications.mark_all_read`
- `notifications.delete`

### Role `pm`  (19 capabilities, src/main/capabilities/pm.ts)

- `pm.create_project`
- `pm.list_projects`
- `pm.read_project`
- `pm.update_project`
- `pm.delete_project`
- `pm.create_position`
- `pm.list_positions`
- `pm.update_position`
- `pm.create_staffing_plan`
- `pm.list_staffing_plans`
- `pm.select_staffing_plan`
- `pm.decompose_position`
- `pm.list_decompositions`
- `pm.match_candidates`
- `pm.list_matches`
- `pm.write_note`
- `pm.read_note`
- `pm.list_notes`
- `pm.star_candidate`

Total: 86 capabilities.

---

## 4. Authentication & access modes

Two bearer-token modes (R1.C2 dual-track):

| Mode | Token | TTL | Role switch |
|---|---|---|---|
| API key (legacy) | `Bearer hp_live_xxx` | indefinite | none (uses registered user_type) |
| Session (R1.C2) | `Bearer sess_xxx` | 168h sliding | `X-Active-Role: pm|hr|candidate` |

Special cases:
- Admin: per-admin `hp_admin_xxx` key, separate auth path
- Webhook inbox (R1.C3): HMAC-verified, no bearer
- Marketplace public: no auth
- Landing: static HTML, no auth

---

## 5. Per-router role gates (T10)

| Router | Allowed role |
|---|---|
| /v1/pm | pm |
| /v1/employer | pm |
| /v1/employer-panel | pm |
| /v1/headhunter | hr |
| /v1/headhunter-workspace | hr |
| /v1/candidate | candidate |
| /v1/admin | admin (separate) |
| /v1/webhooks | HMAC |

Cross-role access returns 403 FORBIDDEN with message 'Role X not allowed here'.

---

## 6. External skill name aliases (R1.C4)

| ow-recruit skill | hunter-platform canonical | HTTP |
|---|---|---|
| ow_recruit.advance_candidate | pm.select_staffing_plan | POST /v1/pm/staffing-plans/:id/select |
| ow_recruit.send_message | candidate_portal.messages.send | POST /v1/candidate-portal/messages |
| ow_recruit.sync_project_to_erp | pm.update_project | PATCH /v1/pm/projects/:id |

Add a new alias by appending `aliases: [...]` to the capability declaration.

---

## 7. Recent migrations (R1 era)

| Version | Description |
|---|---|
| v025 | Candidate Portal (otp_codes, messages, applications) |
| v026 | Recommendation flow (nullable headhunter_id, status extensions) |
| v027 | Hunter workspace (tasks + kanban) |
| v028 | PM Workbench (projects, positions, plans, decompositions, matches, notes) |
| v029 | Extend users.user_type CHECK to allow pm |
| v030 | PM Sandbox: link recommendations to project_positions + stage_entered_at |
| v031 | R1.C2: session table + user_role multi-role + role enum rename (headhunter->hr, employer->pm) |
| v032 | R1.C3: webhook inbox dedup (`webhook_inbox_deliveries` with UNIQUE(endpoint, body_hash)) |

Pre-R1 (still active on prod): v001-v016 + v024.

---

## 8. Operational surfaces (admin-web)

The admin-web/ package is a React 18 + Vite SPA. Routes are guarded
by PrivateRoute. Pages:

| Path | Purpose |
|---|---|
| / (login) | Admin login |
| /admin | Dashboard |
| /admin/users (/+ /:id, /:id/timeline) | User list / detail / action history |
| /admin/candidates (+ variants) | Candidate list / detail / timeline |
| /admin/jobs (+ variants) | Job list / detail / timeline |
| /admin/recommendations (+ variants) | Recommendation list / detail / timeline |
| /admin/placements | Placements + mark-paid / cancel |
| /admin/audit | Audit log (action_history) |
| /admin/webhooks/dead-letter | Failed outbound webhooks (DLQ) |
| /admin/settings | Config (key/value) |
| /admin/rate-limit (R2.5, new) | Rate-limit & quota dashboard |
| /admin/profile | Admin profile / password change |

---

## 9. Where to look next

- Live HTTP contract -> GET /v1/openapi.json (150 routes)
- Agent-facing guide -> docs/superpowers/skill.md (1668 lines)
- Production deploy process -> docs/OPERATIONS.md
- Project memory + runbook -> docs/PROJECT_MEMORY.md
- Source of truth for declared capabilities -> src/main/capabilities/
- History of archived design -> docs/archive/2026-q1/

When this doc and the code disagree, the code wins. Update as part
of any feature PR that changes the totals above.
