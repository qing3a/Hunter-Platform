import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { PlacementTimeline, formatYuan } from '../PlacementTimeline';
import type { Placement, Job } from '../../../api/employer';

// ---- Helpers --------------------------------------------------------------

function makePlacement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: 'plcmt-1',
    job_id: 'job-1',
    candidate_user_id: 'user-7',
    primary_headhunter_id: 'hh-3',
    referrer_headhunter_id: null,
    anonymized_candidate_id: 'cand-A1',
    annual_salary: 360_000, // ¥3,600 / month or ¥360,000 annual — backend stores yuan
    platform_fee: 72_000,
    primary_share: 72_000,
    referrer_share: 0,
    candidate_bonus: 0,
    status: 'pending_payment',
    created_at: '2026-06-15T10:30:00Z',
    updated_at: '2026-06-15T10:30:00Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    employer_id: 'emp-1',
    source_headhunter_id: null,
    created_for_employer_id: null,
    title: 'Senior Backend Engineer',
    description: null,
    required_skills: [],
    salary_min: null,
    salary_max: null,
    status: 'open',
    priority: null,
    deadline: null,
    industry: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('PlacementTimeline — basic render', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a row with the employer-placement-row testid keyed by id', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ id: 'plcmt-42' })}
        jobTitle="Senior Backend Engineer"
      />,
    );
    expect(screen.getByTestId('employer-placement-row-plcmt-42')).toBeInTheDocument();
  });

  it('renders the masked candidate identifier (anonymized_candidate_id)', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ anonymized_candidate_id: 'cand-X9' })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-candidate')).toHaveTextContent('cand-X9');
  });

  it('renders the job title when provided', () => {
    render(
      <PlacementTimeline
        placement={makePlacement()}
        jobTitle="Staff iOS Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-job')).toHaveTextContent('Staff iOS Engineer');
  });

  it('falls back to the raw job_id when no jobTitle is provided', () => {
    render(<PlacementTimeline placement={makePlacement({ job_id: 'job-77' })} />);
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-job')).toHaveTextContent('job-77');
  });

  it('renders the date as a YYYY-MM-DD slice of created_at', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ created_at: '2026-06-15T10:30:00Z' })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-date')).toHaveTextContent('2026-06-15');
  });
});

describe('PlacementTimeline — amount formatting', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders annual_salary as ¥X with thousands separators (yu-an, not cents)', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ annual_salary: 360_000 })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-amount')).toHaveTextContent('¥360,000');
  });

  it('handles large amounts with proper grouping', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ annual_salary: 1_234_567 })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-amount')).toHaveTextContent('¥1,234,567');
  });

  it('handles zero annual_salary gracefully (renders ¥0)', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ annual_salary: 0 })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-amount')).toHaveTextContent('¥0');
  });
});

describe('PlacementTimeline — status badge', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders 待付款 for pending_payment', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ status: 'pending_payment' })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-status')).toHaveTextContent('待付款');
  });

  it('renders 已付款 for paid', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ status: 'paid' })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-status')).toHaveTextContent('已付款');
  });

  it('renders 已取消 for cancelled', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ status: 'cancelled' })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-status')).toHaveTextContent('已取消');
  });

  it('applies a paid-specific class for paid placements', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ status: 'paid' })}
        jobTitle="Engineer"
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-status').className).toContain('paid');
  });
});

describe('PlacementTimeline — click handler', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('invokes onClick when the row is clicked', () => {
    const onClick = vi.fn();
    render(
      <PlacementTimeline
        placement={makePlacement({ id: 'plcmt-99' })}
        jobTitle="Engineer"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('employer-placement-row-plcmt-99'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onClick is omitted (row is a no-op)', () => {
    render(
      <PlacementTimeline
        placement={makePlacement()}
        jobTitle="Engineer"
      />,
    );
    expect(() =>
      fireEvent.click(screen.getByTestId('employer-placement-row-plcmt-1')),
    ).not.toThrow();
  });
});

describe('PlacementTimeline — jobTitle override types', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('accepts a Job object (extracts title)', () => {
    render(
      <PlacementTimeline
        placement={makePlacement({ job_id: 'job-1' })}
        jobTitle={makeJob({ id: 'job-1', title: 'Architect' })}
      />,
    );
    const row = screen.getByTestId('employer-placement-row-plcmt-1');
    expect(within(row).getByTestId('employer-placement-job')).toHaveTextContent('Architect');
  });
});

// ---- formatYuan helper ---------------------------------------------------

describe('formatYuan — pure formatter', () => {
  it('returns ¥0 for 0', () => {
    expect(formatYuan(0)).toBe('¥0');
  });

  it('uses thousands separators', () => {
    expect(formatYuan(1_000)).toBe('¥1,000');
    expect(formatYuan(1_234_567)).toBe('¥1,234,567');
  });
});

// Touch the unused import to keep eslint quiet when helpers grow.
void makeJob;