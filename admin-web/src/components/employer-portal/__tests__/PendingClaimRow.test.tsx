import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { PendingClaimRow, type PendingClaim } from '../PendingClaimRow';
import type { Job } from '../../../api/employer';

// ---- Helpers --------------------------------------------------------------

function makeClaim(overrides: Partial<PendingClaim> = {}): PendingClaim {
  return {
    id: 'job-claim-1',
    employer_id: null,
    source_headhunter_id: 'headhunter-alpha-001',
    created_for_employer_id: 'emp-1',
    title: 'Senior Backend Engineer',
    description: null,
    required_skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    salary_min: null,
    salary_max: null,
    status: 'open',
    priority: 'normal',
    deadline: null,
    industry: '互联网',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    headcount: 3,
    ...overrides,
  } as Job & { headcount?: number };
}

// ---- Tests ---------------------------------------------------------------

describe('PendingClaimRow — rendered content', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders job title, industry, HC, and skill tags', () => {
    render(<PendingClaimRow claim={makeClaim()} onClaim={vi.fn()} onReject={vi.fn()} />);

    const row = screen.getByTestId('employer-pending-claim-row-job-claim-1');
    expect(row).toHaveTextContent('Senior Backend Engineer');
    expect(row).toHaveTextContent('互联网');
    expect(row).toHaveTextContent('HC 3');
    expect(row).toHaveTextContent('TypeScript');
    expect(row).toHaveTextContent('Node.js');
    expect(row).toHaveTextContent('PostgreSQL');
  });

  it('masks the source headhunter identifier instead of exposing the raw id', () => {
    render(
      <PendingClaimRow
        claim={makeClaim({ source_headhunter_id: 'headhunter-sensitive-999' })}
        onClaim={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const row = screen.getByTestId('employer-pending-claim-row-job-claim-1');
    expect(row).toHaveTextContent(/猎头/);
    expect(row).not.toHaveTextContent('headhunter-sensitive-999');
    expect(within(row).getByTestId('employer-pending-claim-headhunter')).toHaveTextContent('he****99');
  });

  it('renders stable fallbacks for missing optional fields', () => {
    render(
      <PendingClaimRow
        claim={makeClaim({
          industry: null,
          source_headhunter_id: null,
          required_skills: [],
          headcount: undefined,
        })}
        onClaim={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    const row = screen.getByTestId('employer-pending-claim-row-job-claim-1');
    expect(row).toHaveTextContent('未标注行业');
    expect(row).toHaveTextContent('未知猎头');
    expect(row).toHaveTextContent('HC 1');
    expect(row).toHaveTextContent('暂无技能标签');
  });
});

describe('PendingClaimRow — actions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calls onClaim with the claim when 领取 is clicked', () => {
    const claim = makeClaim({ id: 'claim-me' });
    const onClaim = vi.fn();
    render(<PendingClaimRow claim={claim} onClaim={onClaim} onReject={vi.fn()} />);

    fireEvent.click(screen.getByTestId('employer-pending-claim-action-claim'));

    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(onClaim).toHaveBeenCalledWith(claim);
  });

  it('calls onReject with the claim when 拒绝 is clicked', () => {
    const claim = makeClaim({ id: 'reject-me' });
    const onReject = vi.fn();
    render(<PendingClaimRow claim={claim} onClaim={vi.fn()} onReject={onReject} />);

    fireEvent.click(screen.getByTestId('employer-pending-claim-action-reject'));

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(claim);
  });
});
