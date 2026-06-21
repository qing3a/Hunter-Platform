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