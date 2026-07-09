# Employer API Inventory (`/v1/employer/*`)

Audit of existing employer backend endpoints to inform the new Employer SPA
(Plan "Employer Panel" sub-task 1). All endpoints are mounted under
`/v1/employer` in `src/main/server.ts:224` via
`createEmployerRouter(db, env.PLATFORM_ENCRYPTION_KEY)`.

Read-only audit — no code changes. References verified against:
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\routes\employer.ts`
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\modules\employer\handler.ts`
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\modules\commission\handler.ts`
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\schemas\employer.ts`
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\schemas\common.ts`
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\modules\auth\middleware.ts`
- `D:\dev\hunter-platform\.worktrees\pm-workbench\src\main\db\repositories\{jobs,recommendations,placements,candidates-anonymized}.ts`

---

## 1. Endpoint List

| # | Method + Path | Handler (file → function) | Request body / params | Response schema (Zod name) | Auth + role |
|---|---------------|---------------------------|------------------------|----------------------------|-------------|
| 1 | `POST /v1/employer/placements` | `commission/handler.ts` → `createPlacement` | `CreatePlacementSchema` (anonymized_candidate_id, job_id, annual_salary) | `CreatePlacementResponseSchema` → `Placement` | Bearer + `user_type === 'employer'`; rec must be `unlocked`; job must belong to caller |
| 2 | `GET /v1/employer/placements?status=` | `commission/handler.ts` → `listPlacements` | query `status?: pending_payment\|paid\|cancelled` | `ListPlacementsResponseSchema` → `Placement[]` (joined to own `jobs`) | Bearer + employer |
| 3 | `POST /v1/employer/jobs` | `employer/handler.ts` → `createJob` | `CreateJobSchema` (title, description, required_skills, salary_min/max, priority, deadline, industry) | `CreateJobResponseSchema` → `Job` | Bearer + employer; consumes `QUOTA_COSTS.create_job` |
| 4 | `GET /v1/employer/jobs?status=` | `employer/handler.ts` → `listMyJobs` | query `status?` | `ListMyJobsResponseSchema` → `Job[]` | Bearer + employer |
| 5 | `GET /v1/employer/talent` | `employer/handler.ts` → `browseTalent` | query: `industry, title_level, min_years, max_years, skills(csv), min_salary, max_salary` | `BrowseTalentResponseSchema` → `TalentPreview[]` (anonymized_id, industry, title_level, years_experience, salary_range, education_tier, skills) | Bearer + employer; consumes `QUOTA_COSTS.browse_talent`; capped at 100 |
| 6 | `POST /v1/employer/recommendations/:id/express-interest` | `employer/handler.ts` → `expressInterest` | path `:id`; no body | `ExpressInterestResponseSchema` → `{ status: 'employer_interested' }` | Bearer + employer; rec must belong to caller; consumes `QUOTA_COSTS.express_interest`; writes `unlock_audit_log`; enqueues webhook |
| 7 | `POST /v1/employer/recommendations/:id/unlock-contact` | `employer/handler.ts` → `unlockContact` | path `:id`; no body | `UnlockContactResponseSchema` → `{ status: 'unlocked' }` | Bearer + employer; consumes `QUOTA_COSTS.unlock_contact`; decrypts PII (name/phone/email); enqueues `deliver_contact` webhook; sends `unlock_granted` notification to candidate |
| 8 | `GET /v1/employer/pending-claims` | `employer/handler.ts` → `listPendingClaims` | none | `PendingClaimsResponseSchema` → `Job[]` (status=`open`, employer_id IS NULL, `created_for_employer_id` = me OR NULL) | Bearer + employer |
| 9 | `POST /v1/employer/claim-jobs/:id` | `employer/handler.ts` → `claimJob` | path `:id`; no body | `ClaimJobResponseSchema` → `Job` (status flipped to `claimed`) | Bearer + employer; atomic; idempotent if already own `claimed` |
| 10 | `POST /v1/employer/reject-jobs/:id` | `employer/handler.ts` → `rejectJob` | path `:id`; body `RejectJobSchema` (reason? ≤500ch) | `RejectJobResponseSchema` → `{ status: 'closed' }` | Bearer + employer; writes `action_history` (capability `employer.reject_job`) |

All routes share: `router.use(authMiddleware(db))` and `router.use(createRateLimitMiddleware(...))`.
Standard envelope `{ ok: true, data: ... }` (`EnvelopeSchema` in `schemas/common.ts`).
Errors thrown via `Errors.*` helpers (e.g. `forbidden`, `notFound`, `invalidState`, `insufficientQuota`, `duplicateRequest`).

---

## 2. Reuse vs Extend vs New — Classification

### 🟢 REUSE (call as-is from the SPA)

| SPA use-case | Endpoint | Notes |
|--------------|----------|-------|
| Job list page | `GET /v1/employer/jobs?status=` | `Job` schema already exposes everything the SPA needs (id, title, status, priority, salary, industry, dates) |
| Job create form | `POST /v1/employer/jobs` | All required fields present |
| Pending claims inbox | `GET /v1/employer/pending-claims` | Returns `open` jobs claimable by this employer |
| Claim a job | `POST /v1/employer/claim-jobs/:id` | One-click from the pending-claims list |
| Reject a job | `POST /v1/employer/reject-jobs/:id` | Modal w/ optional reason |
| Talent pool search | `GET /v1/employer/talent` | All filters (industry, title_level, years, skills, salary band) already supported |
| Express interest on a recommendation | `POST /v1/employer/recommendations/:id/express-interest` | Triggers `recFlow.express_interest` |
| Unlock candidate contact | `POST /v1/employer/recommendations/:id/unlock-contact` | PII delivery via encrypted webhook to agent |
| Placements list | `GET /v1/employer/placements?status=` | Already filtered to caller's jobs |
| Create placement (admin step) | `POST /v1/employer/placements` | Requires unlocked rec + own job |

### 🟡 EXTEND (small wrapper or extra field)

| Use-case | What's missing | Suggested change |
|----------|----------------|------------------|
| Job detail / edit page | No `GET /v1/employer/jobs/:id`; SPA would need to filter `listMyJobs` client-side. Also no `PATCH`/`close` endpoint. | Add `GET /v1/employer/jobs/:id` returning `Job` (cheap; reuse `jobs.findById` + ownership check). Optionally add `POST /v1/employer/jobs/:id/close` to flip `open`/`claimed` → `closed`. |
| Recommendation inbox | `listMyJobs` doesn't include the recommendations targeted at each job. SPA needs to show "interested / unlocked" recs per job. | Either (a) add `GET /v1/employer/recommendations?job_id=&status=` reusing `recommendations.listByEmployer`, or (b) compose in the new dashboard endpoint. |
| Browse → detail | `GET /v1/employer/talent` returns `TalentPreview` (anonymized) — the SPA can't show a full candidate profile from this. Need an employer-view of a candidate. | Add `GET /v1/employer-panel/candidates/:id` (see NEW). |

### 🔴 NEW (employer SPA needs endpoints not yet built)

| # | Endpoint | Rationale | Effort |
|---|----------|-----------|--------|
| N1 | `GET /v1/employer-panel/dashboard` | Single aggregated payload for the SPA home/landing view. Plan lists: `active_jobs`, `open_positions`, `candidates_viewed_this_month`, `interested_count`, `unlocked_count`, `placements_count`, `spend_this_month`. None of the existing endpoints aggregate these in one round-trip. | Medium — aggregate SQL over `jobs`, `recommendations`, `placements`, `unlock_audit_log` |
| N2 | `GET /v1/employer-panel/candidates/:id` | Employer-view of a candidate from a `TalentPreview` card. Returns anonymized profile + (if unlocked for the caller's job) the decrypted contact, the recommendation status for any of this employer's jobs, and the audit trail. Reuses the same privacy boundary as `unlockContact`. | Medium — new handler in `src/main/modules/employer/`; reuses `candidatesAnon.findById`, `recommendations.listByCandidate`, and the `candidates_private` decryption path |

> Note: the plan's third candidate `GET /v1/employer-panel/placements` is **already covered** by
> `GET /v1/employer/placements` (#2 above) — recommend reusing rather than adding a parallel
> route under `/v1/employer-panel/`. The only thing the SPA might need beyond the existing
> endpoint is a "spend this month" number, which is computed in N1's dashboard payload.

---

## 3. Gaps to Fill (detailed)

### N1 — `GET /v1/employer-panel/dashboard`

**Response shape (proposed):**
```ts
{
  ok: true,
  data: {
    active_jobs: number,                // jobs.status IN ('open','claimed') AND employer_id = me
    open_positions: number,             // jobs.status = 'open' AND employer_id = me
    candidates_viewed_this_month: number,// COUNT(*) FROM unlock_audit_log WHERE actor_user_id = me AND created_at >= start_of_month
    interested_count: number,           // COUNT(*) FROM recommendations WHERE employer_id = me AND status = 'employer_interested'
    unlocked_count: number,             // COUNT(*) FROM recommendations WHERE employer_id = me AND status = 'unlocked'
    placements_count: number,           // COUNT(*) FROM placements p JOIN jobs j ON j.id = p.job_id WHERE j.employer_id = me
    spend_this_month: number,           // SUM(platform_fee + primary_share + referrer_share) over placements created this month for me
  }
}
```

**Auth:** `assertEmployer(user)` (see §4) — same pattern as existing routes.

**Rationale:** Today's SPA home would have to call ~6 existing endpoints and aggregate
client-side. That's 6 round-trips + client-side math. One server-side aggregate is
faster, gives the SPA a stable contract, and centralises quota/privacy decisions.

### N2 — `GET /v1/employer-panel/candidates/:id`

**Response shape (proposed):**
```ts
{
  ok: true,
  data: {
    anonymized: {                       // Always present, mirrors TalentPreview
      anonymized_id, industry, title_level, years_experience,
      salary_range, education_tier, skills,
    },
    recommendations_for_my_jobs: [     // Recommendations for this candidate × any of my jobs
      { recommendation_id, job_id, job_title, status, updated_at }
    ],
    unlocked: {                         // Null until employer has paid the unlock cost
      name: string, phone: string, email: string
    } | null,
  }
}
```

**Auth:** `assertEmployer(user)`. Unlock status follows the existing
`unlockContact` flow — `unlocked` is non-null only when at least one
`recommendation` for `me` × `this_candidate` is in status `unlocked`. (Mirrors
the privacy model of `/v1/candidate-portal/*`.)

**Rationale:** Without this, the SPA can only show a flat list of anonymized
cards with no link to a detail page. The endpoint also doubles as the entry
point for "request a re-match" and "view history" features planned in
Tasks 4–6.

---

## 4. Auth Pattern

The plan references `assertEmployer(user)`. There is **no such named function**
in the current codebase — the actual pattern is repeated inline checks at the
top of every handler:

```ts
if (user.user_type !== 'employer') throw Errors.forbidden('Only employers ...');
```

Source: `src/main/modules/employer/handler.ts` lines 42, 74, 79, 147, 220, 313,
323, 355; `src/main/modules/commission/handler.ts` lines 58, 201.

`User` is the type from `src/shared/types.ts`; the `user_type` discriminator is
one of `'candidate' | 'headhunter' | 'employer' | 'pm'` (extended in v029 to
add `'pm'`).

### Bearer-token verification

Mounted globally on the router via `router.use(authMiddleware(db))`
(`employer.ts:55`). Flow in `src/main/modules/auth/middleware.ts`:

1. Read `Authorization` header; require `Bearer ` prefix (`Errors.unauthorized()` otherwise).
2. Slice off the prefix; take the first `API_KEY_PREFIX_LENGTH` (12) chars as the prefix.
3. Query `users` filtered by `api_key_prefix = ? AND status = 'active' AND (api_key_expires_at IS NULL OR > now)`. This narrows the bcrypt candidate set.
4. `verifyApiKey(key, user.api_key_hash)` — bcrypt constant-time compare against the current slot.
5. On match, attach `req.user` (a fully-hydrated `User` row).
6. Grace-slot (`prev_api_key_*`) is **deliberately not consulted** — see the tripwire comment in `auth/middleware.ts:14-23`. To re-introduce a 24h grace window you must edit both `CANDIDATE_SELECT` and `tryVerify` (commit `62329b8` made rotation an immediate cutover).

### Implication for the new SPA

Every new endpoint the SPA calls must either be mounted under an existing
`authMiddleware`-protected router or be wrapped with the same middleware. The
two recommended new endpoints (`/v1/employer-panel/dashboard`,
`/v1/employer-panel/candidates/:id`) should be added to a new
`createEmployerPanelRouter` that reuses the same `authMiddleware(db)` line
— no new auth code is needed. The `assertEmployer(user)` inline check pattern
should be carried over verbatim (or extracted into a tiny helper to keep the
two new handlers consistent with the existing style).

---

## 5. Data Model Reference

Tables the employer-side code reads or writes. All live in
`src/main/db/migrations/v001.sql` through `v016_notifications.sql`; column
shapes verified in the corresponding repository files.

### `jobs`
- Visible to employer (own rows only via `jobs.listByEmployer(employerId)`):
  `id, employer_id, source_headhunter_id, created_for_employer_id, title,
  description, required_skills (parsed from required_skills_json), salary_min,
  salary_max, status, priority, deadline, industry, created_at, updated_at`.
- Statuses: `open | claimed | paused | closed | filled`. (v010 added `claimed`.)
- `source_headhunter_id` and `created_for_employer_id` are NULL for
  employer-direct postings; set when a headhunter posted on the employer's
  behalf (v009).

### `recommendations`
- Employer-visible columns: `id, headhunter_id, employer_id,
  anonymized_candidate_id, job_id, status, source_type, pickup_headhunter_id,
  candidate_note, commission_split_json, referrer_headhunter_id, created_at,
  updated_at`. Plus (used by PM Workbench) `position_id`, `pipeline_stage`,
  `stage_entered_at`.
- Statuses (recFlow): `pending_pickup | pending | employer_interested |
  considering_offer | candidate_approved | unlocked | withdrawn | rejected |
  placed` (v026 added `pending_pickup`).
- Employer never sees `candidate_note` directly on the wire; it's only surfaced
  via the encrypted webhook payload (see `unlockContact` in
  `employer/handler.ts:268-285`).

### `placements`
- Visible (own rows only via `placements.listByEmployer`): `id, job_id,
  candidate_user_id, primary_headhunter_id, referrer_headhunter_id,
  anonymized_candidate_id, annual_salary, platform_fee, primary_share,
  referrer_share, candidate_bonus, status, created_at, updated_at`.
- Statuses: `pending_payment | paid | cancelled`.
- `placements` is JOINed to `jobs` on the wire to enforce `jobs.employer_id =
  caller.id` (see `placements.ts:47-58`).

### `candidates_anonymized` (employer-visible previews)
- Visible columns (via `TalentPreview`): `id (→ anonymized_id), industry,
  title_level, years_experience, salary_range, education_tier, skills (parsed
  from skills_json)`.
- Hidden: `source_private_id` (FK to `candidates_private`), `source_headhunter_id`,
  `is_public_pool`, `unlock_status`, timestamps.
- The `browseTalent` query in `employer/handler.ts:111` hard-filters to
  `is_public_pool = 1`.

### `candidates_private` (PII — never returned unless unlocked)
- Contains: `id, candidate_user_id, name_enc, phone_enc, email_enc, ...`.
- Only ever decrypted inside `unlockContact` (`employer/handler.ts:247-301`)
  with `decrypt(ctx.encryptionKey, ...)` and zeroed in `finally`.
- Employers must NEVER receive `name_enc` / `phone_enc` / `email_enc` in any
  response payload. The N2 endpoint (`/v1/employer-panel/candidates/:id`)
  must follow the same rule: return decrypted strings, or null.

### `unlock_audit_log`
- Tracks every `express_interest` and `unlock_delivery` action with
  `recommendation_id, actor_user_id, action, ip_address, user_agent,
  created_at`. The "candidates viewed this month" counter in N1's dashboard
  counts `actor_user_id = me AND created_at >= start_of_month`.

### `action_history`
- The `rejectJob` handler writes a row with
  `capability_name='employer.reject_job', target_type='job'`. Other employer
  actions are not currently audited here (they live in `unlock_audit_log`
  instead).

### What the employer can vs. cannot see

| Data | Visible pre-unlock | Visible post-unlock |
|------|--------------------|---------------------|
| Anonymized profile (industry, level, years, skills) | yes | yes |
| Candidate's name / phone / email | **no** | **yes** (decrypted) |
| Other employers' jobs (recommendations) | no (filtered by `employer_id = me`) | no |
| Other employers' unlocks of the same candidate | no | no |
| Candidate's full resume / history | no | no (only PII; not the resume blob) |
| Headhunter commission split | partial — `primary_headhunter_id`, `referrer_headhunter_id`, `primary_share`, `referrer_share`, `platform_fee` (via `placements` endpoint after placement) | same |

---

## 6. Summary

- **10 endpoints** currently live under `/v1/employer/*`.
- **🟢 10 reuse**, **🟡 ~3 extend candidates** (job detail, recommendation
  inbox, candidate detail link), **🔴 2 new** (`/v1/employer-panel/dashboard`,
  `/v1/employer-panel/candidates/:id`). The plan's third candidate
  (`/v1/employer-panel/placements`) duplicates the existing
  `GET /v1/employer/placements` and should be reused.
- **Auth pattern** is `router.use(authMiddleware(db))` + inline
  `if (user.user_type !== 'employer') throw Errors.forbidden(...)`. There is
  no `assertEmployer` helper today — the plan's terminology is loose; the
  pattern is real but lives inline.
- **PII boundary** is enforced inside `unlockContact`. The new
  `/v1/employer-panel/candidates/:id` must reuse the same decrypt-and-zero
  flow and never expose `name_enc` / `phone_enc` / `email_enc` to the wire.
