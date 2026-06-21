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