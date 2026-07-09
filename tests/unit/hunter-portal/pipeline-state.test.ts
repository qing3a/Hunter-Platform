import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES,
  STAGE_COLORS,
  STAGE_LABELS,
  canTransition,
  isTerminal,
  nextStages,
} from '../../../src/main/lib/hunter-pipeline.js';
import type { PipelineStage } from '../../../src/main/lib/hunter-pipeline.js';

const allStages = [
  'submitted',
  'screen_passed',
  'interview',
  'offer',
  'onboarded',
  'rejected',
] as const satisfies readonly PipelineStage[];

const expectedTransitions = {
  submitted: ['screen_passed', 'rejected'],
  screen_passed: ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['onboarded', 'rejected'],
  onboarded: [],
  rejected: [],
} satisfies Record<PipelineStage, PipelineStage[]>;

const legalTransitions = Object.entries(expectedTransitions).flatMap(([from, stages]) =>
  stages.map(to => [from as PipelineStage, to] as const)
);

const legalTransitionKeys = new Set(
  legalTransitions.map(([from, to]) => `${from}->${to}`)
);

describe('hunter pipeline state machine', () => {
  it('canTransition returns true for every legal transition', () => {
    for (const [from, to] of legalTransitions) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('canTransition returns false for every illegal transition', () => {
    for (const from of allStages) {
      for (const to of allStages) {
        if (legalTransitionKeys.has(`${from}->${to}`)) continue;

        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('nextStages returns correct next stages for non-terminal stages', () => {
    expect(nextStages('submitted')).toEqual(['screen_passed', 'rejected']);
    expect(nextStages('screen_passed')).toEqual(['interview', 'rejected']);
    expect(nextStages('interview')).toEqual(['offer', 'rejected']);
    expect(nextStages('offer')).toEqual(['onboarded', 'rejected']);
  });

  it('nextStages returns an empty array for terminal stages', () => {
    expect(nextStages('onboarded')).toEqual([]);
    expect(nextStages('rejected')).toEqual([]);
  });

  it('isTerminal returns true for onboarded and rejected', () => {
    expect(isTerminal('onboarded')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
  });

  it('isTerminal returns false for non-terminal stages', () => {
    const nonTerminalStages = [
      'submitted',
      'screen_passed',
      'interview',
      'offer',
    ] as const satisfies readonly PipelineStage[];

    for (const stage of nonTerminalStages) {
      expect(isTerminal(stage)).toBe(false);
    }
  });

  it('STAGE_LABELS has a label for every stage', () => {
    expect(STAGE_LABELS).toEqual({
      submitted: '投递',
      screen_passed: '简历过',
      interview: '面试',
      offer: 'Offer',
      onboarded: '到岗',
      rejected: '已拒绝',
    } satisfies Record<PipelineStage, string>);
  });

  it('STAGE_COLORS has a 6-digit hex color for every stage', () => {
    expect(STAGE_COLORS).toEqual({
      submitted: '#3b82f6',
      screen_passed: '#8b5cf6',
      interview: '#ec4899',
      offer: '#f59e0b',
      onboarded: '#10b981',
      rejected: '#6b7280',
    } satisfies Record<PipelineStage, string>);

    expect(Object.keys(STAGE_COLORS)).toHaveLength(allStages.length);
    for (const stage of allStages) {
      expect(STAGE_COLORS[stage]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('PIPELINE_STAGES contains the 5 non-terminal stages in order', () => {
    expect(PIPELINE_STAGES).toEqual([
      'submitted',
      'screen_passed',
      'interview',
      'offer',
      'onboarded',
    ] satisfies PipelineStage[]);
  });
});
