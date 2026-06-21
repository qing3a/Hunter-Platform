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