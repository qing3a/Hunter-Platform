# Headhunter Workspace — Design Spec

> **Status:** Active spec (basis for plan `2026-07-09-headhunter-workspace-plan.md`)
> **Owner:** Headhunter workspace implementation (Phase 3a)
> **Stack:** React 18 + TypeScript strict + Express + Zod + node:sqlite

---

## 1. Goals & Non-Goals

### Goals

- **G1.** Give headhunters a mobile-first SPA (`/hunter/*`) to manage their pipeline end-to-end: pick up candidates from the queue, see recommended candidates, drag them through a 5-stage kanban, complete personal tasks, and review personal statistics.
- **G2.** Reuse the existing `/v1/headhunter/*` HTTP surface (recommendations, pickup) and the candidate-portal auth/session/UI patterns.
- **G3.** Introduce a formal 5-stage pipeline state machine (`submitted → screen_passed → interview → offer → onboarded` plus a terminal `rejected` branch) and ensure **all** stage transitions — including kanban drag-and-drop — go through `canTransition()` validation.
- **G4.** Provide a personal productivity loop (hunter-owned tasks) independent of the recommendation flow.
- **G5.** Be consistent with the candidate-portal design language (tokens.css, MobileLayout, EmptyState, RadarChart, etc.).

### Non-Goals (explicit)

- **N1.** No employer-facing or PM-facing UI in this spec (handled by separate plans).
- **N2.** No real-time multi-user collaboration on the kanban (single-hunter view; last-write-wins on stage changes).
- **N3.** No notifications/triggers (the candidate-portal `notifications` table exists but this plan does not generate notifications on stage changes).
- **N4.** No email/IM integration. Tasks are in-app only.

---

## 2. Personas

| Persona | Account Type | Auth | Primary Surface |
|---------|--------------|------|-----------------|
| Headhunter | `user_type='headhunter'` | `hp_live_<prefix>…` bearer token via OTP login | `/hunter/*` SPA |
| Admin | `admin_users` row | bearer token | `/admin/*` (existing) — out of scope |
| Candidate | `user_type='candidate'` | bearer token | `/candidate/*` (existing) — out of scope |
| Anonymous | — | none | `/hunter/login` only |

A hunter who tries to reach `/hunter/*` without a hunter session is redirected to `/hunter/login`.

---

## 3. Information Architecture (URL map)

All routes are under `/hunter` and are protected by `RequireHunterAuth` except `/hunter/login`.

| Route | Page | Purpose | Auth |
|-------|------|---------|------|
| `/hunter/login` | `HunterLoginPage` | OTP request + verify (reuses candidate OTP) | Public |
| `/hunter/workspace` | `HunterWorkspacePage` | KPI cards + top-5 tasks + kanban summary + recent recommendations | Hunter |
| `/hunter/pickup` | `PickupQueuePage` | Browse + claim `pending_pickup` recommendations | Hunter |
| `/hunter/candidates` | `CandidateListPage` | Tabular list of hunter-owned recommendations with filters | Hunter |
| `/hunter/candidates/:id` | `CandidateDetailPage` | Full candidate view + hunter-side actions (move stage, edit notes) | Hunter |
| `/hunter/kanban` | `KanbanPage` | 5-column drag-and-drop board | Hunter |
| `/hunter/compare` | `ComparisonPage` | Side-by-side comparison of 2–3 candidates | Hunter |
| `/hunter/tasks` | `TasksPage` | List/create/edit/complete/delete personal tasks | Hunter |
| `/hunter/settings` | `HunterSettingsPage` | Profile + notification preferences + kanban column naming | Hunter |

Layout uses `HunterMobileLayout` (top bar + bottom tab bar) on ≤768px and `HunterSidebar` (left rail) on ≥1024px.

---

## 4. Data Model

### 4.1 New tables (migration `v027_hunter_workspace.sql`)

#### `hunter_tasks`

Personal todo items owned by a single hunter. Independent from the recommendation flow.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | ULID/UUID |
| `hunter_user_id` | TEXT NOT NULL | FK → `users.id` (must be `user_type='headhunter'`) |
| `title` | TEXT NOT NULL | |
| `description` | TEXT NULL | |
| `related_recommendation_id` | TEXT NULL | FK → `recommendations.id` (optional link) |
| `related_candidate_user_id` | TEXT NULL | FK → `users.id` (optional link) |
| `due_at` | INTEGER NULL | Unix ms; null = no due date |
| `completed_at` | INTEGER NULL | Unix ms; null = pending, non-null = completed |
| `priority` | TEXT NOT NULL DEFAULT 'normal' | enum: `low`/`normal`/`high`/`urgent` |
| `created_at` | INTEGER NOT NULL | Unix ms (default `unixepoch() * 1000`) |
| `updated_at` | INTEGER NOT NULL | Unix ms |

Foreign keys:
- `FOREIGN KEY (hunter_user_id) REFERENCES users(id)` — enforces ownership (must be a hunter user)
- `FOREIGN KEY (related_recommendation_id) REFERENCES recommendations(id)` — optional link to a recommendation
- `FOREIGN KEY (related_candidate_user_id) REFERENCES users(id)` — optional link to a candidate user (prevents orphan references; added during implementation, not in the original 2-FK spec — acknowledged as a reasonable data integrity safeguard)

Indexes:
- `idx_hunter_tasks_hunter (hunter_user_id, completed_at)` — for "pending vs completed" lists
- `idx_hunter_tasks_due (hunter_user_id, due_at) WHERE completed_at IS NULL` — partial index for due-soon queries

#### `kanban_columns`

Per-hunter customizable kanban column definitions. Default 5 columns are inserted on first login/onboarding.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `hunter_user_id` | TEXT NOT NULL | FK → `users.id` |
| `name` | TEXT NOT NULL | Display label, e.g. `投递` |
| `position` | INTEGER NOT NULL | Column ordering (0..N) |
| `pipeline_stage` | TEXT NOT NULL | Maps to `recommendations.pipeline_stage` value |
| `created_at` | INTEGER NOT NULL | |

Constraints:
- `UNIQUE(hunter_user_id, name)` — no duplicate column names per hunter
- Index `idx_kanban_columns_hunter (hunter_user_id, position)` — fast board fetch

### 4.2 Altered tables

#### `recommendations`

Two new columns to support the kanban flow. Both default to safe values so existing rows behave correctly.

```sql
ALTER TABLE recommendations ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'submitted';
  -- values: submitted | screen_passed | interview | offer | onboarded | rejected
ALTER TABLE recommendations ADD COLUMN kanban_position INTEGER;
  -- ordering within a hunter's column; NULL = default (last)
```

`pipeline_stage` is also exposed on the candidate-portal (Phase 1) pickup response so hunters can see the current stage when claiming.

### 4.3 Default kanban columns

When a hunter logs in for the first time (detected by absence of any `kanban_columns` row for that user), the backend inserts the standard 5:

```
position=0, name='投递',     pipeline_stage='submitted'
position=1, name='简历过',   pipeline_stage='screen_passed'
position=2, name='面试',     pipeline_stage='interview'
position=3, name='Offer',    pipeline_stage='offer'
position=4, name='到岗',     pipeline_stage='onboarded'
```

The terminal `rejected` stage has no dedicated column — rejected cards disappear from the board (handled by the repository filter).

---

## 5. 5-Stage Pipeline State Machine

Implemented in `src/main/lib/hunter-pipeline.ts` (pure functions, no DB). All kanban moves MUST call `canTransition()` before persisting.

| From | Allowed transitions |
|------|---------------------|
| `submitted` | `screen_passed`, `rejected` |
| `screen_passed` | `interview`, `rejected` |
| `interview` | `offer`, `rejected` |
| `offer` | `onboarded`, `rejected` |
| `onboarded` | — (terminal) |
| `rejected` | — (terminal) |

Exported API:

```ts
export type PipelineStage = 'submitted' | 'screen_passed' | 'interview' | 'offer' | 'onboarded' | 'rejected';

export const PIPELINE_STAGES: PipelineStage[];          // ordered, terminal-stages excluded
export const STAGE_LABELS: Record<PipelineStage, string>;  // Chinese display names
export const STAGE_COLORS: Record<PipelineStage, string>;  // hex for UI badges

export function canTransition(from: PipelineStage, to: PipelineStage): boolean;
export function nextStages(from: PipelineStage): PipelineStage[];
export function isTerminal(stage: PipelineStage): boolean;
```

Color tokens (cross-checked with `tokens.css`):

```
submitted    → #3b82f6 (blue)
screen_passed→ #8b5cf6 (violet)
interview    → #ec4899 (pink)
offer        → #f59e0b (amber)
onboarded    → #10b981 (green, matches --c-hunter)
rejected     → #6b7280 (gray)
```

### Invariants enforced at handler level

1. A `moveCard()` request with `from_stage == to_stage` is treated as a reorder (no stage validation needed).
2. A `moveCard()` request that violates `canTransition()` returns `409 Conflict` with body `{ error: 'invalid_stage_transition', from, to, allowed_next }`.
3. A `rejected` recommendation can be re-opened only by an admin (out of scope for this plan).
4. The terminal `onboarded` triggers an automatic counter increment in the hunter stats overview (no separate table).

---

## 6. HTTP API Surface

Mounted at `/v1/headhunter-workspace` (separate prefix from existing `/v1/headhunter` to keep blast radius minimal). All endpoints require a hunter session (`hp_live_…` with `user_type='headhunter'`).

### 6.1 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/headhunter-workspace/dashboard` | Aggregate payload for `HunterWorkspacePage` |
| GET | `/v1/headhunter-workspace/tasks?status=&limit=&offset=` | List hunter tasks |
| POST | `/v1/headhunter-workspace/tasks` | Create task |
| PUT | `/v1/headhunter-workspace/tasks/:id` | Update task fields (not stage — tasks have no stage) |
| DELETE | `/v1/headhunter-workspace/tasks/:id` | Delete task |
| POST | `/v1/headhunter-workspace/tasks/:id/complete` | Mark task complete (sets `completed_at`) |
| POST | `/v1/headhunter-workspace/tasks/:id/reopen` | Un-complete task (clears `completed_at`) |
| GET | `/v1/headhunter-workspace/kanban` | Get full board (columns + cards) |
| POST | `/v1/headhunter-workspace/kanban/move` | Move card across columns / within column (validates state machine) |
| GET | `/v1/headhunter-workspace/stats?from=&to=` | Overview stats + funnel breakdown |

### 6.2 Request/Response shapes (Zod-validated)

#### GET `/v1/headhunter-workspace/dashboard`

```jsonc
{
  "kpi": {
    "onboards_this_month": 3,
    "active_recommendations": 12,
    "placements_count": 8,
    "conversion_rate": 0.27,
    "pending_pickup_count": 5
  },
  "top_tasks": [ /* up to 5 hunter_tasks */ ],
  "kanban_summary": [
    { "stage": "submitted",     "count": 4 },
    { "stage": "screen_passed", "count": 3 },
    { "stage": "interview",     "count": 2 },
    { "stage": "offer",         "count": 2 },
    { "stage": "onboarded",     "count": 1 }
  ],
  "recent_recommendations": [ /* up to 5 recommendations */ ]
}
```

#### GET `/v1/headhunter-workspace/kanban`

```jsonc
{
  "columns": [
    {
      "id": 1,
      "name": "投递",
      "position": 0,
      "pipeline_stage": "submitted",
      "cards": [
        {
          "recommendation_id": "rec_abc",
          "candidate_user_id": "usr_xyz",
          "candidate_name": "张*",          // desensitized
          "job_title": "前端工程师",
          "match_score": 0.82,
          "kanban_position": 0,
          "updated_at": 1718000000000
        }
      ]
    }
  ]
}
```

#### POST `/v1/headhunter-workspace/kanban/move`

Request:

```jsonc
{
  "recommendation_id": "rec_abc",
  "to_column_id": 2,                    // or omit + use to_stage
  "to_stage": "screen_passed",          // server validates against to_column_id's pipeline_stage
  "to_position": 0                      // optional; null = append to end
}
```

Response (200): the updated card.
Response (409): `{ error: 'invalid_stage_transition', from, to, allowed_next: [...] }`.

#### POST `/v1/headhunter-workspace/tasks`

Request:

```jsonc
{
  "title": "Call candidate",
  "description": "Confirm availability",
  "due_at": 1718086400000,
  "priority": "high",
  "related_recommendation_id": "rec_abc",
  "related_candidate_user_id": "usr_xyz"
}
```

All fields except `title` and `priority` are optional. `priority` defaults to `normal`.

#### GET `/v1/headhunter-workspace/stats?from=&to=`

```jsonc
{
  "overview": {
    "active_recommendations": 12,
    "placements_count": 8,
    "onboards_this_month": 3,
    "pending_pickup_count": 5,
    "conversion_rate": 0.27
  },
  "funnel": [
    { "stage": "submitted",     "count": 24, "conversion_from_prev": 1.0 },
    { "stage": "screen_passed", "count": 12, "conversion_from_prev": 0.5 },
    { "stage": "interview",     "count": 6,  "conversion_from_prev": 0.5 },
    { "stage": "offer",         "count": 3,  "conversion_from_prev": 0.5 },
    { "stage": "onboarded",     "count": 2,  "conversion_from_prev": 0.67 }
  ],
  "range": { "from": 1717468800000, "to": 1720054400000 }
}
```

### 6.3 Errors

All errors follow the existing project shape:

```jsonc
{ "error": "code_in_snake_case", "message": "human readable", "details": { /* optional */ } }
```

Common codes used in this plan: `unauthorized`, `forbidden`, `not_found`, `validation_error`, `invalid_stage_transition`, `conflict`.

---

## 7. Frontend Architecture

### 7.1 Stack & patterns

- React 18 + TypeScript strict + React Router 6 + React Query
- Plain CSS + tokens.css (no Tailwind, no UI library)
- Reuse `MobileLayout`, `EmptyState`, `RadarChart`, `FunnelCard`, `OtpInput` from `admin-web/src/components/candidate-portal/*`
- React Query keys: `['hunter', 'dashboard']`, `['hunter', 'tasks', filters]`, `['hunter', 'kanban']`, `['hunter', 'stats', range]`

### 7.2 Session extension

`CandidateSession` grows an optional `role` field to support multi-role UIs:

```ts
export interface Session {
  api_key: string;
  user_id: string;
  role: 'candidate' | 'headhunter' | 'pm' | 'employer';
  profile_complete?: boolean;  // only for candidates
  display_name?: string;       // optional for headhunters
}
```

A new `admin-web/src/lib/session.ts` (or extension of `candidate-session.ts`) exports:

- `getSession(): Session | null`
- `setSession(s: Session): void`
- `clearSession(): void`
- `getAuthHeader(): string | null`
- `getRole(): Session['role'] | null`
- `useSession()` — React hook wrapping the above

`getRole()` is the gate for `RequireHunterAuth`.

### 7.3 API client (`admin-web/src/api/hunter-portal.ts`)

Type-safe wrappers, one object per resource:

```ts
export const hunterApi = {
  dashboard: {
    get(): Promise<DashboardPayload>;
  },
  tasks: {
    list(filters): Promise<Task[]>;
    create(input): Promise<Task>;
    update(id, patch): Promise<Task>;
    delete(id): Promise<void>;
    complete(id): Promise<Task>;
    reopen(id): Promise<Task>;
  },
  kanban: {
    get(): Promise<KanbanBoard>;
    move(input): Promise<KanbanCard>;
  },
  stats: {
    overview(range?): Promise<StatsPayload>;
  },
};
```

### 7.4 Components

Reusable, testable, single-responsibility:

| Component | Responsibility |
|-----------|----------------|
| `HunterMobileLayout` | Top bar + bottom tab bar (≤768px) |
| `HunterSidebar` | Left rail (≥1024px) |
| `PipelineStageBadge` | Renders a stage with its color + label (with unit tests) |
| `KanbanBoard` | Wraps columns; manages drag state |
| `KanbanColumn` | Drop target + scrollable card list |
| `KanbanCard` | Draggable card (avatar, name, job, score) |
| `HunterStatsCard` | Single KPI tile (label, value, optional trend) |
| `RequireHunterAuth` | HOC: redirects to `/hunter/login` if session.role !== 'headhunter' |

### 7.5 Pages

| Page | Key UI |
|------|--------|
| `HunterLoginPage` | Reuses OTP flow; on success → `/hunter/workspace` |
| `HunterWorkspacePage` | 4 KPI tiles, top-5 tasks list, kanban summary bars, recent recommendations |
| `PickupQueuePage` | Table of pending_pickup recs + inline "认领" button (calls existing `/v1/headhunter/recommendations/:id/pickup`) |
| `CandidateListPage` | Table (desensitized name, stage badge, job title, last activity) + filters (stage, job, keyword) |
| `CandidateDetailPage` | Candidate profile + radar chart + history timeline + actions (move stage, add note, link task) |
| `KanbanPage` | 5-column board with HTML5 drag & drop |
| `ComparisonPage` | 2–3 cards side-by-side: radar chart overlay, table of attributes |
| `TasksPage` | Two tabs: pending/completed; CRUD modals |
| `HunterSettingsPage` | Profile editor (display_name, avatar URL), notification toggles, kanban column rename |

### 7.6 Drag-and-drop

Use HTML5 native drag and drop events (`onDragStart`, `onDragOver`, `onDrop`). No third-party library. State machine validation happens **on the client before mutation** for UX (immediate visual response) and **on the server in the handler** for correctness (always re-validated).

The 409 response from the server on invalid transitions triggers:
1. Toast: "无法移动到该阶段 (允许: …)"
2. Optimistic rollback of the card to its original column
3. Query invalidation to refetch the board

### 7.7 Responsive behavior

- ≤768px: `HunterMobileLayout`, kanban switches to **vertical accordion** (one column visible at a time, prev/next buttons to switch columns)
- ≥1024px: `HunterSidebar`, kanban is a horizontal flex row with overflow-x scroll

### 7.8 Dark mode

Reuses `tokens.css` `[data-theme="dark"]` block. All colors use `var(--*)` tokens — no hardcoded hexes in component CSS (except the stage colors which are imported from the JS constants in `hunter-pipeline.ts` and used as inline `style.color` on the badge).

---

## 8. Auth & Authorization

- All `/v1/headhunter-workspace/*` routes pass through existing `authMiddleware`.
- A new guard `requireHunter` (factory in `src/main/modules/headhunter/middleware.ts`) checks `req.user.user_type === 'headhunter'` and returns 403 otherwise.
- On first login, if the hunter has zero `kanban_columns`, the server seeds the default 5 before responding.
- `RequireHunterAuth` on the frontend mirrors this: it calls `/v1/capabilities/me` if `role` is missing from session, and refreshes the session role.

---

## 9. Testing Strategy

### 9.1 Unit tests

- `tests/unit/hunter-portal/pipeline-state.test.ts` — state machine: all valid transitions, invalid transitions, terminal stages, `canTransition`/`nextStages`/`isTerminal`
- `admin-web/src/components/hunter-portal/__tests__/PipelineStageBadge.test.tsx` — renders all stages with correct colors + labels, handles unknown stage gracefully
- `admin-web/src/components/hunter-portal/__tests__/KanbanCard.test.tsx` — drag attributes, click handler
- `admin-web/src/components/hunter-portal/__tests__/KanbanColumn.test.tsx` — drop target behavior

### 9.2 Integration tests (use `tests/helpers/test-app.ts`)

- `tests/integration/hunter-portal/tasks.test.ts` — CRUD + auth (hunter can only mutate own tasks) + status filter
- `tests/integration/hunter-portal/kanban.test.ts` — getBoard (after onboarding columns), moveCard (valid + invalid transitions), addCard/removeCard
- `tests/integration/hunter-portal/stats.test.ts` — overview aggregates + funnel conversions
- `tests/integration/hunter-portal/dashboard.test.ts` — aggregate endpoint returns all sections with consistent data

### 9.3 Test data

- A `seedHunter(hunterUserId, options?)` helper inside `tests/helpers/test-app.ts` creates a hunter user + kanban columns.
- Each test starts from a fresh SQLite DB (handled by `test-app.ts`).
- 409 paths are explicitly tested (invalid stage transitions).

---

## 10. Observability & Audit

- All write endpoints log to `action_history` with `capability_name` set to a new `headhunter_workspace.*` namespace:
  - `headhunter_workspace.task.create`
  - `headhunter_workspace.task.update`
  - `headhunter_workspace.task.complete`
  - `headhunter_workspace.task.reopen`
  - `headhunter_workspace.task.delete`
  - `headhunter_workspace.kanban.move`
- `trace_id` is captured via the existing OTel middleware.
- No new metrics are introduced (reuse existing `prom-client` registry).

---

## 11. Acceptance Criteria

- [ ] Headhunter can log in via OTP and lands on `/hunter/workspace`.
- [ ] On first login, the 5 default kanban columns are auto-seeded.
- [ ] Hunter can see at most 5 pending tasks on the dashboard and can promote/demote via the tasks page.
- [ ] Hunter can view `pending_pickup` queue and claim any item; claimed items appear in the candidate list with stage `submitted`.
- [ ] Hunter can drag a card from any column to a legal next stage; the server enforces `canTransition` and returns 409 on illegal moves.
- [ ] Hunter can create, edit, complete, reopen, and delete tasks; these operations are scoped to the owning hunter.
- [ ] Stats endpoint computes correct funnel ratios for any `[from, to]` window.
- [ ] Mobile (≤768px) shows vertical accordion kanban; desktop (≥1024px) shows horizontal columns.
- [ ] Dark mode renders correctly across all pages.
- [ ] `pnpm typecheck` reports 0 errors. All new tests pass. Pre-existing failure (`admin-list-pagination.test.ts`) is acknowledged and not regressed.

---

## 12. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Schema conflicts with parallel PM/Employer plans on `recommendations` | Portfolio agreement: Plan 1 (this) owns `recommendations` extensions |
| Existing rows with no `pipeline_stage` defaulting to `submitted` may not match historical reality | `DEFAULT 'submitted'` is safe — these rows have no kanban position anyway |
| Drag-and-drop UX regressions on mobile browsers | Test on Chrome Android + Safari iOS; fallback tap-to-move menu if needed |
| Race conditions on concurrent kanban moves | Last-write-wins; board query refetches on invalidation; documented in code |
| 33 uncommitted landing WIP changes on main | Explicitly out of scope — do not touch |

---

## 13. Out-of-Scope Followups

- Real-time board updates via SSE/WebSocket (future plan)
- Bulk claim from pickup queue (future plan)
- Hunter-to-hunter referral handoff (future plan)
- Admin override of hunter stage decisions (future plan)
- Email/IM notifications on stage change (future plan)