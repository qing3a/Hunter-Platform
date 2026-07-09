import { describe, it, expect } from 'vitest';
import { stageColor, stageBg, stageLabel, STAGES } from '../stage-tokens';

describe('stage-tokens', () => {
  it('STAGES is in canonical order with 4 stages', () => {
    expect(STAGES).toEqual(['projects', 'positions', 'candidates', 'matches']);
  });

  it('stageColor returns CSS var ref for each stage', () => {
    expect(stageColor('projects')).toBe('var(--c-stage-project)');
    expect(stageColor('positions')).toBe('var(--c-stage-position)');
    expect(stageColor('candidates')).toBe('var(--c-stage-candidate)');
    expect(stageColor('matches')).toBe('var(--c-stage-match)');
  });

  it('stageBg returns background var ref', () => {
    expect(stageBg('matches')).toBe('var(--b-stage-match)');
  });

  it('stageLabel returns Chinese label', () => {
    expect(stageLabel('projects')).toBe('项目');
    expect(stageLabel('matches')).toBe('匹配');
  });
});