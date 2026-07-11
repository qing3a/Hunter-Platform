# Session Token + Multi-Role Auth Design

**Status**: Active (brainstormed 2026-07-11)
**Date**: 2026-07-11
**Author**: Self
**Implements**: R1.C2 from `2026-07-11-positioning.md` roadmap
**Unblocks**: ow-recruit M6 (multi-role + session) integration
**Related**: ow-recruit `server/auth/session.js`, `0003_multi_role_and_session.sql`

---

## 1. Goals

1. Add session token auth alongside existing apikey auth (dual-track)
2. Allow one user to hold all three roles (pm / hr / candidate)
3. Add `X-Active-Role` header to switch active role per session
4. Migrate existing users: rename legacy roles, grant all 3 roles to everyone
5. Preserve apikey auth for backward compatibility

---

## 2. Frozen decisions

| # | Decision | Source |
|---|---|---|
| D1 | Role enum = `{pm, hr, candidate}` (headhunter→hr, employer→pm) | brainstorm |
| D2 | Dual-track auth: apikey keeps working, session is additive | brainstorm |
| D3 | Register auto-grants all 3 roles | brainstorm |
| D4 | Session TTL = **1 week (168h), sliding window** | brainstorm |
| D5 | Migration backfills all 3 roles for existing users | brainstorm |

---

## 3. Data model

### 3.1 New table `user_role` (multi-role mapping)

```sql
CREATE TABLE user_role (
  user_id    TEXT NOT NULL REFERENCES user(id),
  role       TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE INDEX idx_user_role_user ON user_role(user_id);
```

### 3.2 New table `session` (long-lived auth)

```sql
CREATE TABLE session (
  id           TEXT PRIMARY KEY,           -- sess_<32 chars>
  user_id      TEXT NOT NULL REFERENCES user(id),
  active_role  TEXT NOT NULL CHECK (active_role IN ('pm','hr','candidate')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,              -- sliding: refresh updates = now + 168h
  last_used_at TEXT NOT NULL,
  revoked_at   TEXT,                       -- NULL = active; non-null = logout'd
  ip_address   TEXT,                       -- for audit / suspicious login detection
  user_agent   TEXT                        -- optional, client-side identification
);
CREATE INDEX idx_session_user     ON session(user_id);
CREATE INDEX idx_session_expires  ON session(expires_at);
CREATE INDEX idx_session_active   ON session(active_role) WHERE revoked_at IS NULL;
```

### 3.3 Existing `user` table

- `user_type` column **stays** for legacy code compatibility and audit, but is **no longer authoritative for RBAC**
- New code MUST use `req.user.active_role` instead
- Existing values are remapped in migration:
  - `headhunter` → `hr`
  - `employer` → `pm`
  - `candidate` → `candidate` (unchanged)
- After migration, `user_type` equals the user's first/primary role (whatever order they were registered in); for new users it's the role they chose at register

### 3.4 Existing `api_key` table

No schema change. Continues to work as before.

---

## 4. API endpoints

### 4.1 POST `/v1/auth/register` (modified)

**Request:**
```json
{
  "user_type": "pm" | "hr" | "candidate",     // accepts legacy "headhunter" / "employer" too, remapped
  "name": "string (1-100 chars)",
  "contact": "string (optional)",
  "agent_endpoint": "url (optional)"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "user_xxx",
    "api_key": "hp_live_xxxx",               // plaintext, shown once
    "quota_per_day": 100,
    "user_type": "pm",                        // primary role (kept for back-compat)
    "available_roles": ["pm", "hr", "candidate"]  // ← NEW: always 3
  }
}
```

**Side effects:**
- Inserts row into `user` table (with remapped user_type if legacy)
- Inserts 3 rows into `user_role` table (pm, hr, candidate)
- Inserts row into `api_key` table

### 4.2 POST `/v1/auth/login` (new)

**Request:**
```json
{
  "api_key": "hp_live_xxxx",
  "active_role": "pm" | "hr" | "candidate"   // optional; defaults to first available
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "session_id": "sess_xxxx",
    "active_role": "pm",
    "available_roles": ["pm", "hr", "candidate"],
    "expires_at": "2026-07-18T12:00:00Z",
    "user_id": "user_xxx",
    "name": "张 PM"
  }
}
```

**Errors:**
- `401 unauthorized` if api_key invalid/revoked
- `403 forbidden` if `active_role` requested but not in user's available_roles

### 4.3 POST `/v1/auth/refresh` (new)

**Headers:** `Authorization: Bearer sess_xxx`
**Body (optional):**
```json
{ "active_role": "hr" }
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "session_id": "sess_xxxx",
    "active_role": "hr",
    "expires_at": "2026-07-18T12:00:00Z"
  }
}
```

**Side effects:**
- Updates `session.last_used_at = now`
- Updates `session.expires_at = now + 168h` (sliding window)
- If body has `active_role`: updates `session.active_role` (must be in available_roles)

**Errors:**
- `401 unauthorized` if session revoked/expired
- `403 forbidden` if `active_role` not in user's available_roles

### 4.4 POST `/v1/auth/logout` (new)

**Headers:** `Authorization: Bearer sess_xxx`
**Body:** empty
**Response:** `{ "ok": true }`
**Side effect:** Sets `session.revoked_at = now`. Idempotent.

### 4.5 POST `/v1/auth/rotate-key` (unchanged behavior)

Continues to work as today: apikey → new apikey, no grace period (immediate replacement).

**Accepts both auth methods:**
- `Authorization: Bearer hp_live_xxx` (existing path)
- `Authorization: Bearer sess_xxx` (new path, for consistency with the rest of the new auth surface)

In both cases, the **target user is the one identified by the token**, not the active_role.

---

## 5. Auth middleware

### 5.1 Dual-track resolution

```
Authorization: Bearer <token>
                │
                ├── token starts with "sess_" → session lookup
                │     └── SELECT session JOIN user_role ...
                │     └── 401 if not found / revoked / expired
                │     └── 403 if X-Active-Role in request is not in user's roles
                │
                └── token starts with "hp_live_" → apikey lookup (existing path)
                      └── SELECT user JOIN user_role ...
                      └── 401 if not found / revoked
                      └── no X-Active-Role handling (apikey = single role)
```

### 5.2 X-Active-Role header behavior

| Auth method | X-Active-Role absent | X-Active-Role present |
|---|---|---|
| `sess_*` | use `session.active_role` (sticky) | if in user.available_roles → update session.active_role + return; else 403 |
| `hp_live_*` | use `user.user_type` (single-role, no switching) | 400 (apikey doesn't support role switching) |

### 5.3 req.user shape (post-change)

```typescript
type AuthedUser = {
  id: string;
  name: string;
  roles: ('pm'|'hr'|'candidate')[];
  active_role: 'pm'|'hr'|'candidate';
  auth_method: 'session' | 'apikey';
  session_id?: string;
  ip_address?: string;
  user_agent?: string;
};
```

`req.user.user_type` is **deprecated**; new code uses `req.user.active_role`. Existing code reading `user_type` continues to work (returns the remapped string).

---

## 6. WebSocket auth

### 6.1 Connection URL patterns

```
ws://host/v1/events?session=sess_xxx&role=pm      ← new recommended
ws://host/v1/events?session=sess_xxx              ← new (uses session's stored role)
ws://host/v1/events?key=hp_live_xxx                ← legacy, still supported
```

### 6.2 On connect

- **session path**: load session, validate `role` param is in user's available_roles (else close 4001). Server records `user_id` + `active_role` per connection.
- **apikey path**: load user via apikey, record `user_id` + `user_type` as `active_role` (unchanged).
- Both paths: re-establish subscriptions via `since_event_id` from the existing flow.

---

## 7. RBAC: per-endpoint role gating

### 7.1 New middleware `roleGate(allowedRoles[])`

```typescript
export function roleGate(...allowedRoles: Role[]) {
  return (req, res, next) => {
    if (!req.user) return next(Errors.unauthorized());
    if (!allowedRoles.includes(req.user.active_role)) {
      return next(Errors.forbidden(`Role '${req.user.active_role}' not allowed here`));
    }
    next();
  };
}
```

### 7.2 Endpoint role table (additions)

| Path prefix | Allowed roles |
|---|---|
| `/v1/candidate/*` | `candidate` |
| `/v1/market/jobs` (public) | (public, no role required) |
| `/v1/jobs` (HR view) | `hr` |
| `/v1/employer/projects` | `pm` |
| `/v1/headhunter/talent` | `hr` |
| `/v1/employer/matches` | `pm` |
| `/v1/candidate/applications` | `candidate` |
| `/v1/candidate/messages` | `candidate`, `pm`, `hr` (any) |
| `/v1/commission/*` | `pm`, `hr` |
| `/v1/admin/*` | admin_users (separate table, not in scope) |

Endpoints not listed: any authenticated user can call.

---

## 8. Migration plan (v031)

### 8.1 Migration file `v031_session_and_multirole.sql`

```sql
-- 1. user_role table
CREATE TABLE user_role (
  user_id    TEXT NOT NULL REFERENCES user(id),
  role       TEXT NOT NULL CHECK (role IN ('pm','hr','candidate')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE INDEX idx_user_role_user ON user_role(user_id);

-- 2. session table
CREATE TABLE session (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES user(id),
  active_role  TEXT NOT NULL CHECK (active_role IN ('pm','hr','candidate')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at   TEXT,
  ip_address   TEXT,
  user_agent   TEXT
);
CREATE INDEX idx_session_user    ON session(user_id);
CREATE INDEX idx_session_expires ON session(expires_at);

-- 3. Remap legacy user_type values
UPDATE user SET user_type = 'hr' WHERE user_type = 'headhunter';
UPDATE user SET user_type = 'pm' WHERE user_type = 'employer';
-- candidate unchanged

-- 4. Backfill: grant all 3 roles to every existing user
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'pm',        datetime('now') FROM user;
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'hr',        datetime('now') FROM user;
INSERT INTO user_role (user_id, role, granted_at)
SELECT id, 'candidate', datetime('now') FROM user;
```

### 8.2 Code migration

Mechanical renames in `src/main/`:
- `'headhunter'` → `'hr'`
- `'employer'` → `'pm'`
- `user_type === 'X'` checks → `active_role === 'X'`

These renames should be done via a single sed/script pass with manual verification.

---

## 9. Backward compatibility

| Concern | Handling |
|---|---|
| Existing apikey users | Continue to work; `user_type` mapped in migration; `req.user.user_type` returns remapped value |
| Existing API clients (REST) | No changes required unless they want session |
| Existing API clients (WS via apikey) | Continue to work |
| Admin users (admin_users table) | Out of scope for this spec; admin auth unchanged |
| skill.md / OpenAPI | Regenerate to include new endpoints + X-Active-Role header |

---

## 10. Testing strategy

### 10.1 Unit / integration (vitest)

| Suite | Tests | Coverage |
|---|---|---|
| `tests/integration/migration-v031.test.ts` | 5 | user_role + session tables created; legacy user_type remapped; all 3 roles backfilled |
| `tests/unit/session-repo.test.ts` | 15 | createSession, resolveSession (active/expired/revoked), revokeSession, refresh expiry |
| `tests/unit/user-role-repo.test.ts` | 8 | grantRole, revokeRole, listRoles, isInRole |
| `tests/integration/auth-middleware.test.ts` | 20 | session + apikey dual track; X-Active-Role validation; expired/revoked rejection |
| `tests/integration/auth-login.test.ts` | 12 | login happy path + 7 error paths |
| `tests/integration/auth-refresh.test.ts` | 10 | refresh renews expiry; optional role switch |
| `tests/integration/auth-logout.test.ts` | 5 | logout revokes session; idempotent |
| `tests/integration/auth-rbac.test.ts` | 25 | one test per gated endpoint × 3 roles = role matrix |
| `tests/integration/ws-auth.test.ts` | 10 | session+role connect, apikey connect, 4001 on invalid role |
| **Total** | **~110 new tests** | |

### 10.2 Existing test updates

Every existing test that uses `user_type: 'headhunter'` or `'employer'` must be updated to `'hr'` / `'pm'`. Estimated 50-80 test file edits.

### 10.3 E2E (Playwright)

No new e2e (admin-web e2e doesn't cover user-role flows).

### 10.4 Interop test (manual / scripted)

- Spin up ow-recruit relay against this hunter-platform
- Run ow-recruit's mock-e2e test: register → login → switch role → call skill → receive webhook
- Script: `tests/interop/ow-recruit-e2e.sh` (to be written in follow-up spec)

---

## 11. Documentation updates

| Doc | Change |
|---|---|
| `docs/superpowers/skill.md` | Add X-Active-Role section, session lifecycle, role-switching pattern |
| `docs/api.md` | New endpoints (login/refresh/logout); updated register response; RBAC table |
| `README.md` | Quick-start example uses session |
| `docs/superpowers/specs/2026-07-11-positioning.md` | Mark R1.C2 done (post-impl) |
| OpenAPI | Regenerate via `pnpm openapi:generate` |

---

## 12. Implementation order

1. **M1**: Migration v031 + new repos (`session-repo`, `user-role-repo`)
2. **M2**: Auth middleware dual-track + X-Active-Role handling
3. **M3**: New endpoints (login/refresh/logout); modify register
4. **M4**: WebSocket auth (session path; keep apikey path)
5. **M5**: RBAC middleware + per-endpoint role gates
6. **M6**: Mechanical rename (`headhunter`/`employer` → `hr`/`pm`)
7. **M7**: Documentation + OpenAPI regeneration
8. **M8**: Interop test with ow-recruit

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Existing user_type callers break | Keep `req.user.user_type` returning remapped string; update call sites incrementally |
| Large mechanical rename misses a file | Codemod script + grep audit after; CI lint rule checking for legacy values |
| Session table grows unbounded | Add cleanup cron (separate task) to delete expired sessions > 30 days old |
| X-Active-Role header injection (user spoofs role) | Header is **advisory** only; **server-side check is `active_role IN user.available_roles`** |
| Backward-compat: client uses apikey + expects single role | apikey still works, `user_type` field preserved with remapped value |
| `user_role` INSERT race on register | Wrap user creation + user_role inserts in transaction (already in scope of register refactor) |

---

## 14. Out of scope

- Admin users (admin_users table) auth changes — separate concern
- Multi-tenancy
- 2FA / TOTP
- OAuth / SSO integration
- Session cleanup cron (separate spec)
- Real-time RBAC change propagation (e.g., admin revokes role while user is connected)
- Per-role quota differentiation (already exists via `QUOTA_PER_DAY` config)