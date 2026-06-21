# Flow State Machines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize every state machine + its side effects into a single declarative `Flow` definition per domain (recommendation, job, user). Handlers become thin: `flow.transition(from, event, ctx)` instead of `assertTransition + updateStatus + webhooks.enqueue + audit_log.insert`.

**Architecture:**

- `src/main/flows/types.ts` — `Flow<S, E>` type + `defineFlow()` builder + `applyTransition()` runner. Pure types, no runtime deps.
- `src/main/flows/recommendation.ts` — replaces `src/main/modules/unlock/state-machine.ts`. Same `RecStatus` enum, same transitions (8 states, 4 terminals), same side effects (webhook enqueue).
- `src/main/flows/job.ts` — **new** explicit state machine for `JobStatus` (5 states). Side effects: webhook on claim, status-change event on reject/close.
- `src/main/flows/user.ts` — **new** explicit state machine for `UserStatus` (3 states: active, suspended, deleted). Side effects: audit log on every transition.
- `src/main/flows/index.ts` — re-exports all flows + `applyTransition(flow, currentState, event, ctx)` runner.
- `src/main/modules/unlock/state-machine.ts` — keep file as a **deprecated re-export shim** (deleted in a follow-up release). One commit deletes it after all callers migrate.

**Why now:** Phase 0 already fixed one Bug 2/3 instance (claim→status='claimed', reject→guard 'open'). The fix was inline in `employer/handler.ts`. If we add another state transition later, the same bug could reappear. Centralizing makes the state machine + side effects one source of truth.

**Tech Stack:** TypeScript. No new dependencies. Pure declarative objects, runtime is a tiny helper.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/main/flows/types.ts` | `Flow<S, E>` type, `defineFlow()`, `assertCanTransition()`, `applyTransition()` |
| `src/main/flows/recommendation.ts` | The 8-state rec flow (currently inline in `modules/unlock/state-machine.ts`) |
| `src/main/flows/job.ts` | The 5-state job flow (`open` → `claimed`/`paused`/`closed`/`filled`) |
| `src/main/flows/user.ts` | The 3-state user flow (`active` → `suspended` → `deleted`) |
| `src/main/flows/index.ts` | Aggregator + `applyTransition()` runner |
| `tests/unit/flows/recommendation.test.ts` | Unit tests for rec flow (replaces `tests/unit/unlock/state-machine.test.ts`) |
| `tests/unit/flows/job.test.ts` | Unit tests for job flow |
| `tests/unit/flows/user.test.ts` | Unit tests for user flow |

### Modified files

| File | Change |
|---|---|
| `src/main/modules/candidate/handler.ts` | `approveUnlock` / `rejectUnlock` use `applyTransition(recFlow, …)` instead of `assertTransition + recs.updateStatus + webhooks.enqueue` |
| `src/main/modules/employer/handler.ts` | `expressInterest` / `unlockContact` / `claimJob` / `rejectJob` use flow |
| `src/main/modules/admin/handlers/users.ts` | `suspend` / `unsuspend` use flow |
| `src/main/modules/unlock/state-machine.ts` | Becomes a 1-line re-export shim (deprecated) |
| `tests/unit/unlock/state-machine.test.ts` | Delete (replaced by `tests/unit/flows/recommendation.test.ts`) |
| `docs/superpowers/skill.md` | Add "State Machines" section + v1.6 changelog |

### Deleted files (last Task)

| File | Reason |
|---|---|
| `src/main/modules/unlock/state-machine.ts` | Logic moved to `flows/recommendation.ts` |
| `tests/unit/unlock/state-machine.test.ts` | Replaced by `tests/unit/flows/recommendation.test.ts` |

---

## Task 1: Write the Flow types + helpers

**Files:**
- Create: `src/main/flows/types.ts`
- Test: `tests/unit/flows/types.test.ts`

- [ ] **Step 1.1: Write failing test**

```typescript
// tests/unit/flows/types.test.ts
import { describe, it, expect } from 'vitest';
import { defineFlow, assertCanTransition, applyTransition, TransitionError } from '../../../src/main/flows/types';

type S = 'a' | 'b' | 'c';
type E = 'go_b' | 'go_c' | 'go_a'; // for testing reverse transitions

const sampleFlow = defineFlow<S, E>({
  initial: 'a',
  states: {
    a: { go_b: 'b', go_c: 'c' },
    b: { go_a: 'a' },
    c: {},  // terminal
  },
  sideEffects: {
    'a->b': () => ({ kind: 'log' as const, message: 'a to b' }),
    'b->a': () => ({ kind: 'log' as const, message: 'b to a' }),
  },
});

describe('defineFlow + assertCanTransition + applyTransition', () => {
  it('assertCanTransition returns true for legal transitions', () => {
    expect(assertCanTransition(sampleFlow, 'a', 'go_b')).toBe(true);
    expect(assertCanTransition(sampleFlow, 'b', 'go_a')).toBe(true);
  });

  it('assertCanTransition returns false for illegal transitions', () => {
    expect(assertCanTransition(sampleFlow, 'c', 'go_a')).toBe(false);
    expect(assertCanTransition(sampleFlow, 'a', 'go_a')).toBe(false); // no direct a->a
  });

  it('applyTransition runs the transition + returns next state + side effect', () => {
    const result = applyTransition(sampleFlow, 'a', 'go_b', {});
    expect(result.next).toBe('b');
    expect(result.sideEffect).toEqual({ kind: 'log', message: 'a to b' });
  });

  it('applyTransition throws TransitionError on illegal transition', () => {
    expect(() => applyTransition(sampleFlow, 'c', 'go_a', {})).toThrow(TransitionError);
  });

  it('applyTransition with no side effect defined returns null', () => {
    const result = applyTransition(sampleFlow, 'a', 'go_c', {});
    expect(result.next).toBe('c');
    expect(result.sideEffect).toBeNull();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/types`
Expected: FAIL with "Cannot find module '../../../src/main/flows/types'"

- [ ] **Step 1.3: Implement `src/main/flows/types.ts`**

```typescript
// src/main/flows/types.ts
/**
 * Flow<S, E> — a single-source-of-truth state machine for one domain.
 *
 * - `S` is the state type (e.g. RecStatus, JobStatus, UserStatus).
 * - `E` is the event type (named actions, e.g. 'approve_unlock', 'claim').
 * - `states[from][event] = to` declares a legal transition.
 * - `sideEffects['from->to']` optionally declares what to do on transition
 *   (webhook enqueue, audit log, etc.). Returns a SideEffect or null.
 *
 * Why declarative: the Bug 2/3 fix (claim→status='claimed', reject guard
 * 'open') was inline in employer/handler.ts. Centralizing means the next
 * state transition can't silently skip the status update or webhook.
 */

export class TransitionError extends Error {
  constructor(public from: string, public event: string) {
    super(`Invalid state transition: cannot '${event}' from '${from}'`);
    this.name = 'TransitionError';
  }
}

export interface TransitionContext {
  /** Read-only context for guards and side effects. Pass DB or repos in here. */
  [key: string]: unknown;
}

/** A side effect is a description of work to do AFTER the transition commits.
 *  Concrete shape: { kind: 'webhook', ... } | { kind: 'audit_log', ... } | etc.
 *  The handler is responsible for interpreting and dispatching. */
export type SideEffect = { kind: string; [key: string]: unknown };

export interface Flow<S extends string, E extends string> {
  initial: S;
  states: { [K in S]?: { [Ev in E]?: S } };
  sideEffects?: { [transitionKey: string]: (ctx: TransitionContext) => SideEffect | null };
}

export function defineFlow<S extends string, E extends string>(
  spec: Flow<S, E>
): Flow<S, E> {
  return spec;
}

export function assertCanTransition<S extends string, E extends string>(
  flow: Flow<S, E>,
  from: S,
  event: E,
): boolean {
  return Boolean(flow.states[from]?.[event]);
}

export interface TransitionResult<S extends string> {
  next: S;
  sideEffect: SideEffect | null;
}

export function applyTransition<S extends string, E extends string>(
  flow: Flow<S, E>,
  from: S,
  event: E,
  ctx: TransitionContext,
): TransitionResult<S> {
  const to = flow.states[from]?.[event];
  if (!to) throw new TransitionError(from, event);
  const transitionKey = `${from}->${to}`;
  const effectFn = flow.sideEffects?.[transitionKey];
  const sideEffect = effectFn ? effectFn(ctx) : null;
  return { next: to as S, sideEffect };
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/types`
Expected: PASS (5 tests)

- [ ] **Step 1.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/flows/types.ts tests/unit/flows/types.test.ts
git commit -m "feat(flows): add Flow type + defineFlow + assertCanTransition + applyTransition"
```

---

## Task 2: Write the recommendation flow

**Files:**
- Create: `src/main/flows/recommendation.ts`
- Test: `tests/unit/flows/recommendation.test.ts`

- [ ] **Step 2.1: Write failing test**

```typescript
// tests/unit/flows/recommendation.test.ts
import { describe, it, expect } from 'vitest';
import { recFlow, REC_TERMINAL_STATUSES, REC_SIDE_EFFECTS } from '../../../src/main/flows/recommendation';

describe('recommendation flow', () => {
  it('matches the existing TRANSITIONS table (regression: same as modules/unlock/state-machine.ts)', () => {
    // From pending
    expect(recFlow.states.pending?.express_interest).toBe('employer_interested');
    expect(recFlow.states.pending?.reject_employer).toBe('rejected_employer');
    expect(recFlow.states.pending?.withdraw).toBe('withdrawn');
    // From employer_interested
    expect(recFlow.states.employer_interested?.approve_unlock).toBe('candidate_approved');
    expect(recFlow.states.employer_interested?.reject_candidate).toBe('rejected_candidate');
    expect(recFlow.states.employer_interested?.reject_employer).toBe('rejected_employer');
    // From candidate_approved
    expect(recFlow.states.candidate_approved?.unlock).toBe('unlocked');
    expect(recFlow.states.candidate_approved?.reject_candidate).toBe('rejected_candidate');
    // From unlocked
    expect(recFlow.states.unlocked?.place).toBe('placed');
    // Terminals
    expect(recFlow.states.rejected_employer).toEqual({});
    expect(recFlow.states.rejected_candidate).toEqual({});
    expect(recFlow.states.withdrawn).toEqual({});
    expect(recFlow.states.placed).toEqual({});
  });

  it('exports the 4 terminal status set', () => {
    expect(REC_TERMINAL_STATUSES.size).toBe(4);
    expect(REC_TERMINAL_STATUSES.has('rejected_employer')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('rejected_candidate')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('withdrawn')).toBe(true);
    expect(REC_TERMINAL_STATUSES.has('placed')).toBe(true);
  });

  it('express_interest side effect enqueues notify_unlock_request webhook', () => {
    const eff = REC_SIDE_EFFECTS['pending->employer_interested']({
      employer_id: 'e1',
      candidate_user_id: 'c1',
      recommendation_id: 'r1',
    } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'c1',
      event_type: 'notify_unlock_request',
    });
  });

  it('approve_unlock side effect enqueues notify_unlock_approved to employer', () => {
    const eff = REC_SIDE_EFFECTS['employer_interested->candidate_approved']({
      employer_id: 'e1',
    } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'e1',
      event_type: 'notify_unlock_approved',
    });
  });

  it('unlock side effect enqueues deliver_contact to employer (contains PII)', () => {
    const eff = REC_SIDE_EFFECTS['candidate_approved->unlocked']({
      employer_id: 'e1',
    } as any);
    expect(eff).toEqual({
      kind: 'webhook',
      target_user_id: 'e1',
      event_type: 'deliver_contact',
      contains_pii: 1,
    });
  });

  it('terminal transitions have no side effects', () => {
    expect(REC_SIDE_EFFECTS['pending->withdrawn']).toBeUndefined();
    expect(REC_SIDE_EFFECTS['pending->rejected_employer']).toBeUndefined();
    expect(REC_SIDE_EFFECTS['unlocked->placed']).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/recommendation`
Expected: FAIL with "Cannot find module"

- [ ] **Step 2.3: Implement `src/main/flows/recommendation.ts`**

```typescript
// src/main/flows/recommendation.ts
import type { RecStatus } from '../../shared/types.js';
import { defineFlow, type Flow, type SideEffect } from './types.js';

/**
 * Recommendation state machine — replaces src/main/modules/unlock/state-machine.ts.
 *
 * Same transitions as the original TRANSITIONS table (Bug 2/3 fix preserved):
 *   pending → employer_interested, rejected_employer, withdrawn
 *   employer_interested → candidate_approved, rejected_candidate, rejected_employer
 *   candidate_approved → unlocked, rejected_candidate
 *   unlocked → placed
 *   rejected_employer / rejected_candidate / withdrawn / placed: terminal
 *
 * Side effects (webhooks) match what the handlers currently enqueue inline.
 */

export type RecEvent =
  | 'express_interest'      // employer → employer_interested
  | 'reject_employer'        // employer → rejected_employer
  | 'withdraw'               // headhunter → withdrawn
  | 'approve_unlock'         // candidate → candidate_approved
  | 'reject_candidate'       // candidate → rejected_candidate
  | 'unlock'                 // employer → unlocked
  | 'place';                 // employer → placed (post-success)

export const REC_TERMINAL_STATUSES = new Set<RecStatus>([
  'rejected_employer', 'rejected_candidate', 'withdrawn', 'placed',
]);

/** Side-effect builders, keyed by 'from->to'. Return null or a SideEffect. */
export const REC_SIDE_EFFECTS: { [k: string]: (ctx: any) => SideEffect | null } = {
  'pending->employer_interested': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.candidate_user_id,
    event_type: 'notify_unlock_request',
  }),
  'employer_interested->candidate_approved': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'notify_unlock_approved',
  }),
  'candidate_approved->unlocked': (ctx) => ({
    kind: 'webhook',
    target_user_id: ctx.employer_id,
    event_type: 'deliver_contact',
    contains_pii: 1,
  }),
  // Terminal transitions intentionally have no side effect: the handler
  // already wrote an action_history row (or will, via the next business
  // step like placement creation).
};

export const recFlow: Flow<RecStatus, RecEvent> = defineFlow({
  initial: 'pending',
  states: {
    pending: {
      express_interest: 'employer_interested',
      reject_employer: 'rejected_employer',
      withdraw: 'withdrawn',
    },
    employer_interested: {
      approve_unlock: 'candidate_approved',
      reject_candidate: 'rejected_candidate',
      reject_employer: 'rejected_employer',
    },
    candidate_approved: {
      unlock: 'unlocked',
      reject_candidate: 'rejected_candidate',
    },
    unlocked: {
      place: 'placed',
    },
    rejected_employer: {},
    rejected_candidate: {},
    withdrawn: {},
    placed: {},
  },
  sideEffects: REC_SIDE_EFFECTS,
});
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/recommendation`
Expected: PASS (6 tests)

- [ ] **Step 2.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/flows/recommendation.ts tests/unit/flows/recommendation.test.ts
git commit -m "feat(flows): add recommendation flow (replaces modules/unlock/state-machine.ts)"
```

---

## Task 3: Write the job flow

**Files:**
- Create: `src/main/flows/job.ts`
- Test: `tests/unit/flows/job.test.ts`

- [ ] **Step 3.1: Write failing test**

```typescript
// tests/unit/flows/job.test.ts
import { describe, it, expect } from 'vitest';
import { jobFlow, JOB_TERMINAL_STATUSES } from '../../../src/main/flows/job';

describe('job flow', () => {
  it('open → claimed by employer', () => {
    expect(jobFlow.states.open?.claim).toBe('claimed');
  });

  it('open and claimed → closed by reject (only open is rejectable per spec §5.3)', () => {
    expect(jobFlow.states.open?.reject).toBe('closed');
    // claimed → reject is intentionally not allowed (Bug 2/3 fix preserved)
    expect(jobFlow.states.claimed?.reject).toBeUndefined();
  });

  it('open → paused / open → closed by employer', () => {
    expect(jobFlow.states.open?.pause).toBe('paused');
    expect(jobFlow.states.open?.close).toBe('closed');
  });

  it('paused → open / paused → closed', () => {
    expect(jobFlow.states.paused?.resume).toBe('open');
    expect(jobFlow.states.paused?.close).toBe('closed');
  });

  it('claimed → filled (when a placement is created) / claimed → paused / closed', () => {
    expect(jobFlow.states.claimed?.fill).toBe('filled');
    expect(jobFlow.states.claimed?.pause).toBe('paused');
    expect(jobFlow.states.claimed?.close).toBe('closed');
  });

  it('filled / closed: terminal', () => {
    expect(jobFlow.states.filled).toEqual({});
    expect(jobFlow.states.closed).toEqual({});
  });

  it('exports the 2 terminal status set (closed + filled)', () => {
    expect(JOB_TERMINAL_STATUSES.size).toBe(2);
    expect(JOB_TERMINAL_STATUSES.has('closed')).toBe(true);
    expect(JOB_TERMINAL_STATUSES.has('filled')).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/job`
Expected: FAIL

- [ ] **Step 3.3: Implement `src/main/flows/job.ts`**

```typescript
// src/main/flows/job.ts
import type { JobStatus } from '../../shared/types.js';
import { defineFlow, type Flow, type SideEffect } from './types.js';

/**
 * Job posting state machine.
 *
 * Bug 2/3 fix preserved: claim flips status open → claimed. Reject only
 * works from open (not from claimed) — once an employer claims a job,
 * they must explicitly close/cancel it, not reject it. This rule is
 * enforced by the flow: rejected transition exists only on `open` and
 * `paused`, not on `claimed`.
 *
 * Recommend (from headhunter/handler.ts) is NOT a job state transition —
 * the recommendation has its own status. The job.status stays the same
 * when a recommendation is created. The state machine only governs
 * employer-side status changes.
 */

export type JobEvent =
  | 'claim'    // open → claimed
  | 'reject'   // open → closed (only from open; claimed employers must close explicitly)
  | 'pause'    // open | claimed → paused
  | 'resume'   // paused → open
  | 'close'    // open | claimed | paused → closed
  | 'fill';    // claimed → filled (when a placement is created)

export const JOB_TERMINAL_STATUSES = new Set<JobStatus>(['closed', 'filled']);

export const jobFlow: Flow<JobStatus, JobEvent> = defineFlow({
  initial: 'open',
  states: {
    open: {
      claim: 'claimed',
      reject: 'closed',
      pause: 'paused',
      close: 'closed',
    },
    claimed: {
      pause: 'paused',
      close: 'closed',
      fill: 'filled',
    },
    paused: {
      resume: 'open',
      close: 'closed',
    },
    filled: {},   // terminal
    closed: {},   // terminal
  },
});
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/job`
Expected: PASS (7 tests)

- [ ] **Step 3.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/flows/job.ts tests/unit/flows/job.test.ts
git commit -m "feat(flows): add job flow (5-state open|claimed|paused|closed|filled)"
```

---

## Task 4: Write the user flow

**Files:**
- Create: `src/main/flows/user.ts`
- Test: `tests/unit/flows/user.test.ts`

- [ ] **Step 4.1: Write failing test**

```typescript
// tests/unit/flows/user.test.ts
import { describe, it, expect } from 'vitest';
import { userFlow, USER_TERMINAL_STATUSES } from '../../../src/main/flows/user';

describe('user flow', () => {
  it('active → suspended (admin action)', () => {
    expect(userFlow.states.active?.suspend).toBe('suspended');
  });

  it('suspended → active (admin action: unsuspend)', () => {
    expect(userFlow.states.suspended?.unsuspend).toBe('active');
  });

  it('suspended → deleted (admin action: GDPR delete)', () => {
    expect(userFlow.states.suspended?.delete).toBe('deleted');
  });

  it('active → deleted is NOT allowed (must suspend first to trigger GDPR flow)', () => {
    expect(userFlow.states.active?.delete).toBeUndefined();
  });

  it('deleted: terminal (no transitions out)', () => {
    expect(userFlow.states.deleted).toEqual({});
  });

  it('exports the 1 terminal status (deleted)', () => {
    expect(USER_TERMINAL_STATUSES.size).toBe(1);
    expect(USER_TERMINAL_STATUSES.has('deleted')).toBe(true);
  });

  it('suspend side effect writes an admin_action_log row', () => {
    const fx = userFlow.sideEffects!['active->suspended']({
      actor: 'admin_1',
      reason: 'spam',
    } as any);
    expect(fx).toEqual({
      kind: 'admin_action_log',
      action_type: 'suspend_user',
      target_id: undefined, // set by handler before calling
      reason: 'spam',
    });
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/user`
Expected: FAIL

- [ ] **Step 4.3: Implement `src/main/flows/user.ts`**

```typescript
// src/main/flows/user.ts
import type { UserStatus } from '../../shared/types.js';
import { defineFlow, type Flow, type SideEffect } from './types.js';

/**
 * User account state machine.
 *
 * active → suspended → deleted
 *                  ↑       ↑
 *        unsuspend    delete (GDPR)
 *
 * Why active → deleted is not allowed: GDPR / "right to be forgotten"
 * should be a deliberate admin action after a suspension period
 * (gives the user a chance to recover / appeal). The flow makes this
 * a single-step process: admin must explicitly suspend first.
 *
 * Both 'suspend' and 'delete' transitions write an admin_action_log row
 * — the audit trail is part of the state machine's side effect, not
 * scattered through the handler.
 */

export type UserEvent = 'suspend' | 'unsuspend' | 'delete';

export const USER_TERMINAL_STATUSES = new Set<UserStatus>(['deleted']);

export const userFlow: Flow<UserStatus, UserEvent> = defineFlow({
  initial: 'active',
  states: {
    active: {
      suspend: 'suspended',
    },
    suspended: {
      unsuspend: 'active',
      delete: 'deleted',
    },
    deleted: {},
  },
  sideEffects: {
    'active->suspended': (ctx: any) => ({
      kind: 'admin_action_log',
      action_type: 'suspend_user',
      target_id: ctx.user_id,
      reason: ctx.reason ?? '',
    }),
    'suspended->deleted': (ctx: any) => ({
      kind: 'admin_action_log',
      action_type: 'delete_user',
      target_id: ctx.user_id,
      reason: ctx.reason ?? 'GDPR delete',
    }),
  },
});
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `cd /d/dev/hunter-platform && pnpm test tests/unit/flows/user`
Expected: PASS (7 tests)

- [ ] **Step 4.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/flows/user.ts tests/unit/flows/user.test.ts
git commit -m "feat(flows): add user flow (3-state active|suspended|deleted)"
```

---

## Task 5: Write the flows index

**Files:**
- Create: `src/main/flows/index.ts`

- [ ] **Step 5.1: Implement `src/main/flows/index.ts`**

```typescript
// src/main/flows/index.ts
/**
 * Aggregator + convenience re-exports.
 *
 * Handlers should import from '../flows/index.js' (or '../flows') — never
 * directly from a specific flow file — so that the imports match the
 * structure of the Flow abstraction.
 */
export {
  recFlow, REC_SIDE_EFFECTS, REC_TERMINAL_STATUSES,
} from './recommendation.js';
export type { RecEvent } from './recommendation.js';

export {
  jobFlow, JOB_TERMINAL_STATUSES,
} from './job.js';
export type { JobEvent } from './job.js';

export {
  userFlow, USER_TERMINAL_STATUSES,
} from './user.js';
export type { UserEvent } from './user.js';

export {
  defineFlow, assertCanTransition, applyTransition, TransitionError,
} from './types.js';
export type { Flow, SideEffect, TransitionContext, TransitionResult } from './types.js';
```

- [ ] **Step 5.2: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/flows/index.ts
git commit -m "feat(flows): add index.ts aggregator + re-exports"
```

---

## Task 6: Migrate candidate handler to use the rec flow

**Files:**
- Modify: `src/main/modules/candidate/handler.ts`
- Modify: `src/main/modules/unlock/state-machine.ts` (becomes a 1-line deprecated shim)

- [ ] **Step 6.1: Read current handlers**

Read `src/main/modules/candidate/handler.ts` to identify the exact lines for `approveUnlock` and `rejectUnlock`. Both currently use `assertTransition` + `recs.updateStatus` + `webhooks.enqueue`.

- [ ] **Step 6.2: Replace import and migrate approveUnlock**

In `src/main/modules/candidate/handler.ts`:

Replace:
```typescript
import { assertTransition } from '../unlock/state-machine.js';
```

With:
```typescript
import { recFlow, applyTransition } from '../../flows/index.js';
```

Then in `approveUnlock`, replace the current `assertTransition + recs.updateStatus + webhooks.enqueue` sequence with:

```typescript
const result = applyTransition(recFlow, rec.status, 'approve_unlock', { employer_id: rec.employer_id });
recs.updateStatus(rec.id, result.next);
audit.insert({
  recommendation_id: rec.id, actor_user_id: user.id, action: 'approve_unlock',
  ip_address: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
});
if (result.sideEffect?.kind === 'webhook') {
  webhooks.enqueue({
    target_user_id: result.sideEffect.target_user_id as string,
    event_type: result.sideEffect.event_type as any,
    payload_enc: encrypt(encryptionKey, JSON.stringify(approvePayload)),
    contains_pii: (result.sideEffect.contains_pii as 0 | 1 | undefined) ?? 0,
    traceparent: getTraceparentFromContext() ?? null,
  });
}
```

(Adjust variable names to match the file's existing payload-building code. The `approvePayload` variable already exists in the function body.)

- [ ] **Step 6.3: Migrate rejectUnlock the same way**

Replace `assertTransition(rec.status, 'rejected_candidate')` + `recs.updateStatus(rec.id, 'rejected_candidate')` with:

```typescript
const result = applyTransition(recFlow, rec.status, 'reject_candidate', {});
// Terminal transition — no side effect (rejected_candidate has none in the flow)
recs.updateStatus(rec.id, result.next);
```

(Rejected_candidate is a terminal state, no side effect expected. The handler still writes the audit row, which is the right call.)

- [ ] **Step 6.4: Make state-machine.ts a deprecated shim**

Replace the entire body of `src/main/modules/unlock/state-machine.ts` with:

```typescript
// DEPRECATED: this file is a backward-compat shim. The state machine now
// lives in src/main/flows/recommendation.ts. New code should import
// from there. This shim will be removed in v1.7.
export {
  recFlow, REC_SIDE_EFFECTS, REC_TERMINAL_STATUSES,
} from '../../flows/recommendation.js';
```

(Re-export the same names. The old `canTransition` and `assertTransition` are NOT re-exported here because they're renamed/replaced in the new flow API. If the old test still references them, see Task 11 for cleanup.)

- [ ] **Step 6.5: Run candidate tests**

Run: `cd /d/dev/hunter-platform && pnpm test candidate`
Expected: PASS (existing behavior preserved)

- [ ] **Step 6.6: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/candidate/handler.ts src/main/modules/unlock/state-machine.ts
git commit -m "refactor(candidate): use recFlow for approveUnlock / rejectUnlock"
```

---

## Task 7: Migrate employer handler (recommendation transitions)

**Files:**
- Modify: `src/main/modules/employer/handler.ts`

- [ ] **Step 7.1: Replace import**

Replace:
```typescript
import { assertTransition } from '../unlock/state-machine.js';
```

With:
```typescript
import { recFlow, applyTransition } from '../../flows/index.js';
```

- [ ] **Step 7.2: Migrate `expressInterest`**

In the `expressInterest` handler, replace the `assertTransition + recommendations.updateStatus + webhooks.enqueue` sequence with:

```typescript
const result = applyTransition(recFlow, rec.status, 'express_interest', {
  candidate_user_id: priv.candidate_user_id,
});
recommendations.updateStatus(rec.id, result.next);

if (result.sideEffect?.kind === 'webhook') {
  webhooks.enqueue({
    target_user_id: result.sideEffect.target_user_id as string,
    event_type: result.sideEffect.event_type as any,
    payload_enc: payloadEnc,
    contains_pii: (result.sideEffect.contains_pii as 0 | 1 | undefined) ?? 0,
    traceparent: getTraceparentFromContext() ?? null,
  });
}
```

(Adjust to fit the existing function body's variable names.)

- [ ] **Step 7.3: Migrate `unlockContact`**

Same pattern:
```typescript
const result = applyTransition(recFlow, rec.status, 'unlock', { employer_id: user.id });
recommendations.updateStatus(rec.id, result.next);

if (result.sideEffect?.kind === 'webhook') {
  webhooks.enqueue({
    target_user_id: result.sideEffect.target_user_id as string,
    event_type: result.sideEffect.event_type as any,
    payload_enc: payloadEnc,
    contains_pii: 1,  // unlock always delivers PII
    traceparent: getTraceparentFromContext() ?? null,
  });
}
```

- [ ] **Step 7.4: Run employer tests**

Run: `cd /d/dev/hunter-platform && pnpm test employer`
Expected: PASS

- [ ] **Step 7.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/employer/handler.ts
git commit -m "refactor(employer): use recFlow for expressInterest / unlockContact"
```

---

## Task 8: Migrate employer handler (job state transitions)

**Files:**
- Modify: `src/main/modules/employer/handler.ts`

- [ ] **Step 8.1: Add jobFlow import**

In `src/main/modules/employer/handler.ts`, extend the import to:

```typescript
import { recFlow, jobFlow, applyTransition } from '../../flows/index.js';
```

- [ ] **Step 8.2: Migrate `claimJob`**

Replace the current `jobs.claimByEmployer(...)` call with a flow-based version. Since `claimByEmployer` is a special atomic SQL update, keep it as the underlying DB write but wrap the validation in a flow call:

```typescript
// 1. Validate the transition is legal
applyTransition(jobFlow, job.status, 'claim', {});  // throws TransitionError if not 'open'

// 2. Atomic DB write (kept as-is — it's an atomic UPDATE that handles idempotency)
const claimed = jobs.claimByEmployer(input.job_id, user.id);
if (!claimed) throw Errors.invalidState('Claim race: job no longer available');
return claimed;
```

If `job.status` is not `'open'`, `applyTransition` throws TransitionError, which the existing try/catch around the handler converts to a 409 INVALID_STATE (matching the existing error contract). The `tryTransition` step is purely defensive — the SQL `claimByEmployer` is already guarded by `status = 'open'`, but the flow check makes the intent explicit.

- [ ] **Step 8.3: Migrate `rejectJob`**

```typescript
applyTransition(jobFlow, job.status, 'reject', {});  // throws if not 'open'
// ... existing transaction body ...
jobs.updateStatus(input.job_id, 'closed');
```

- [ ] **Step 8.4: Run employer tests**

Run: `cd /d/dev/hunter-platform && pnpm test employer-claim-reject employer`
Expected: PASS (including the regression test for claim→reject 409)

- [ ] **Step 8.5: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/employer/handler.ts
git commit -m "refactor(employer): use jobFlow for claimJob / rejectJob state checks"
```

---

## Task 9: Migrate admin user handler

**Files:**
- Modify: `src/main/modules/admin/handlers/users.ts`

- [ ] **Step 9.1: Add import + replace raw SQL with flow-based update**

In `src/main/modules/admin/handlers/users.ts`:

Replace:
```typescript
import { Errors } from '../../../errors.js';
```

With (extending):
```typescript
import { Errors } from '../../../errors.js';
import { userFlow, applyTransition } from '../../../flows/index.js';
```

Then refactor `suspend`:
```typescript
suspend(user_id: string, reason: string): { user_id: string; status: 'suspended'; reason: string } {
  // Validate transition (active → suspended)
  const currentUser = users.findById(user_id);
  if (!currentUser) throw Errors.notFound('User not found');
  const result = applyTransition(userFlow, currentUser.status, 'suspend', { user_id, reason });
  db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(result.next, new Date().toISOString(), user_id);
  // side effect: admin_action_log
  if (result.sideEffect?.kind === 'admin_action_log') {
    adminLog.insert({
      actor: ... (current admin user), // see handler signature
      action_type: result.sideEffect.action_type as string,
      target_type: 'user',
      target_id: user_id,
      reason,
    });
  }
  return { user_id, status: 'suspended' as const, reason };
}
```

(The exact `actor` and `adminLog` call depends on the existing handler's parameters. Read the current `suspend`/`unsuspend` signatures first and adapt.)

Refactor `unsuspend` similarly with `'unsuspend'` event.

- [ ] **Step 9.2: Run admin tests**

Run: `cd /d/dev/hunter-platform && pnpm test admin`
Expected: PASS

- [ ] **Step 9.3: Commit**

```bash
cd /d/dev/hunter-platform
git add src/main/modules/admin/handlers/users.ts
git commit -m "refactor(admin/users): use userFlow for suspend / unsuspend transitions"
```

---

## Task 10: Delete old state-machine files

**Files:**
- Delete: `src/main/modules/unlock/state-machine.ts`
- Delete: `tests/unit/unlock/state-machine.test.ts`

- [ ] **Step 10.1: Delete the files**

```bash
cd /d/dev/hunter-platform
git rm src/main/modules/unlock/state-machine.ts
git rm tests/unit/unlock/state-machine.test.ts
```

- [ ] **Step 10.2: Run full test suite**

Run: `cd /d/dev/hunter-platform && pnpm test`
Expected: PASS (was 600, +15 from new flow tests = 615)

- [ ] **Step 10.3: Typecheck + openapi check**

Run: `cd /d/dev/hunter-platform && pnpm typecheck && pnpm openapi:check`
Expected: 0 errors / 0 forward gaps

- [ ] **Step 10.4: Commit**

```bash
cd /d/dev/hunter-platform
git commit -m "chore(flows): delete deprecated state-machine.ts + its test

The recommendation state machine logic now lives in
src/main/flows/recommendation.ts. All callers migrated in Tasks 6-9.
Removing the shim + the old test keeps the directory structure clean.
"
```

---

## Task 11: Update skill.md + final verification

**Files:**
- Modify: `docs/superpowers/skill.md`

- [ ] **Step 11.1: Add v1.6 changelog entry**

In Appendix B, insert:
```markdown
| v1.6 | 2026-06-22 | **Phase 3**: 显式状态机。recommendation / job / user 三个 flow 集中到 `src/main/flows/`。删除旧 `modules/unlock/state-machine.ts` (deprecated 已在 v1.5 末完成)。615 tests pass |
```

- [ ] **Step 11.2: Add "State Machines" section to skill.md**

After the "分布式追踪 (Phase 2)" section, add:

```markdown
## 🔄 状态机 (Phase 3)

每个 domain 的状态机集中在 `src/main/flows/<domain>.ts` 一个文件:

- `recommendation.ts` — 8 状态 (pending → employer_interested → candidate_approved → unlocked → placed, 4 terminal)
- `job.ts` — 5 状态 (open → claimed | paused, claimed → filled, terminal: closed/filled)
- `user.ts` — 3 状态 (active → suspended → deleted)

每个 flow 声明:
- `states[from][event] = to` — 合法的状态转移
- `sideEffects['from->to']` — 转移时触发的副作用 (webhook / audit log)

Handler 通过 `applyTransition(flow, from, event, ctx)` 触发转移,返回 `{ next, sideEffect }`。
返回后 handler 自己负责: 写 DB 状态 + 派发 sideEffect (enqueue webhook 等)。
这样 state machine 是一处声明,handler 不会忘记更新 status 或漏发 webhook。
```

- [ ] **Step 11.3: Run full suite + typecheck + openapi**

Run: `cd /d/dev/hunter-platform && pnpm typecheck && pnpm test && pnpm openapi:check`
Expected: all green

- [ ] **Step 11.4: Commit**

```bash
cd /d/dev/hunter-platform
git add docs/superpowers/skill.md
git commit -m "docs(skill): document Phase 3 state machine abstraction"
```

---

## Self-Review Checklist

- [ ] All 11 tasks done; 11 atomic commits (plus the final doc)
- [ ] `pnpm test` passes (600 baseline + ~15 new flow tests = ~615)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm openapi:check` passes
- [ ] Old `tests/unit/unlock/state-machine.test.ts` deleted
- [ ] Old `src/main/modules/unlock/state-machine.ts` deleted (after the shim Task)
- [ ] `skill.md` documents the Flow abstraction for external Agent authors
- [ ] No behavior change: same transitions, same side effects, same error codes

---

## Definition of Done

1. All 3 flow files (`recommendation.ts`, `job.ts`, `user.ts`) exist with declarative Flow + side effects.
2. All 5 handlers (candidate/approveUnlock, candidate/rejectUnlock, employer/expressInterest, employer/unlockContact, employer/claimJob, employer/rejectJob, admin/suspend, admin/unsuspend) call `applyTransition` instead of `assertTransition` + manual `updateStatus` + manual `webhooks.enqueue`.
3. `src/main/modules/unlock/state-machine.ts` deleted.
4. `tests/unit/unlock/state-machine.test.ts` deleted; replaced by `tests/unit/flows/{recommendation,job,user}.test.ts`.
5. Unit tests for each flow (legal/illegal transitions, side effects, terminal states).
6. Full integration suite (599 baseline tests) still passes.
7. `skill.md` documents the Flow contract + v1.6 changelog.

## Out of Scope (deferred)

- **Auto-generate OpenAPI state machine diagram from flow definitions** — separate concern.
- **Visual flow editor for admins** — future v2 product surface.
- **Migrate placement status to a flow** — `Placement.status` has 3 states (`pending_payment`, `paid`, `cancelled`) but the transitions are scattered across `markPaid` / `cancelPlacement` handlers. Defer to a follow-up since placement state changes are admin-only and the current code is clear.
- **Time-based transitions** (e.g. "auto-suspend after 90 days inactive") — not in scope.
- **Event sourcing / audit log replay** — would require rewriting the audit table; defer.
