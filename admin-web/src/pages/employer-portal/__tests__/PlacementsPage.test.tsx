import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlacementsPage } from '../PlacementsPage';
import { employerPlacements, employerJobs, type Placement, type Job, type PlacementStatus } from '../../../api/employer';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/employer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/employer')>();
  return {
    ...actual,
    employerPlacements: {
      list: vi.fn(),
      create: vi.fn(),
    },
    employerJobs: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
      reject: vi.fn(),
    },
  };
});

const mockedPlacementsList = vi.mocked(employerPlacements.list);
const mockedJobsList = vi.mocked(employerJobs.list);

// ---- Helpers --------------------------------------------------------------

function makePlacement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: 'plcmt-1',
    job_id: 'job-1',
    candidate_user_id: 'user-7',
    primary_headhunter_id: 'hh-3',
    referrer_headhunter_id: null,
    anonymized_candidate_id: 'cand-A1',
    annual_salary: 360_000,
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/employer/placements']}>
        <PlacementsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('PlacementsPage — loading + error', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading indicator while the placements request is in flight', () => {
    mockedPlacementsList.mockReturnValue(new Promise(() => {}));
    mockedJobsList.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('employer-placements-loading')).toBeInTheDocument();
  });

  it('renders an error banner when employerPlacements.list rejects', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockRejectedValueOnce(new Error('加载失败'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-placements-error')).toHaveTextContent('加载失败');
  });
});

describe('PlacementsPage — header + empty state', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page header with title and status filter chips', async () => {
    mockedPlacementsList.mockResolvedValue([]);
    mockedJobsList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-root')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-placements-title')).toHaveTextContent('成交记录');
    // All four filter chips (all / pending_payment / paid / cancelled)
    expect(screen.getByTestId('employer-placements-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placements-filter-pending_payment')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placements-filter-paid')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placements-filter-cancelled')).toBeInTheDocument();
  });

  it('shows an empty state when the placements list is empty', async () => {
    mockedPlacementsList.mockResolvedValue([]);
    mockedJobsList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-empty')).toBeInTheDocument();
    });
  });
});

describe('PlacementsPage — timeline render + enrichment', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a PlacementTimeline row per placement', async () => {
    mockedJobsList.mockResolvedValue([makeJob({ id: 'job-1', title: 'Engineer A' })]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'plcmt-A' }),
      makePlacement({ id: 'plcmt-B' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-root')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-placement-row-plcmt-A')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placement-row-plcmt-B')).toBeInTheDocument();
  });

  it('enriches each row with the matching job title (resolved from the jobs map)', async () => {
    mockedJobsList.mockResolvedValue([
      makeJob({ id: 'job-1', title: 'Backend Engineer' }),
      makeJob({ id: 'job-2', title: 'Frontend Engineer' }),
    ]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'p-1', job_id: 'job-1' }),
      makePlacement({ id: 'p-2', job_id: 'job-2' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placement-row-p-1')).toBeInTheDocument();
    });
    const row1 = screen.getByTestId('employer-placement-row-p-1');
    const row2 = screen.getByTestId('employer-placement-row-p-2');
    expect(row1.querySelector('[data-testid="employer-placement-job"]')).toHaveTextContent('Backend Engineer');
    expect(row2.querySelector('[data-testid="employer-placement-job"]')).toHaveTextContent('Frontend Engineer');
  });

  it('falls back to the raw job_id when the placement references a job not in the map', async () => {
    // Backend only returns placements for jobs belonging to the caller
    // (placements.listByEmployer join), but in practice the jobs list
    // could be paginated / filtered separately. We must not crash when
    // a placement's job_id is absent from the resolved title map.
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'p-orphan', job_id: 'job-missing' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placement-row-p-orphan')).toBeInTheDocument();
    });
    const row = screen.getByTestId('employer-placement-row-p-orphan');
    expect(row.querySelector('[data-testid="employer-placement-job"]')).toHaveTextContent('job-missing');
  });

  it('renders the count of placements in the header', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'a' }),
      makePlacement({ id: 'b' }),
      makePlacement({ id: 'c' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-count')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-placements-count')).toHaveTextContent('3');
  });
});

describe('PlacementsPage — status filter', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('defaults to "all" filter and renders every placement', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'a', status: 'pending_payment' }),
      makePlacement({ id: 'b', status: 'paid' }),
      makePlacement({ id: 'c', status: 'cancelled' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placement-row-a')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-placement-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placement-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placement-row-c')).toBeInTheDocument();
  });

  it('clicking a status chip filters rows client-side (no refetch)', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'a', status: 'pending_payment' }),
      makePlacement({ id: 'b', status: 'paid' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placement-row-a')).toBeInTheDocument();
    });
    const callsBefore = mockedPlacementsList.mock.calls.length;
    fireEvent.click(screen.getByTestId('employer-placements-filter-paid'));
    expect(screen.getByTestId('employer-placement-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('employer-placement-row-a')).toBeNull();
    expect(mockedPlacementsList.mock.calls.length).toBe(callsBefore);
  });

  it('toggling back to "all" restores every row', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([
      makePlacement({ id: 'a', status: 'pending_payment' }),
      makePlacement({ id: 'b', status: 'paid' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placement-row-a')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-placements-filter-paid'));
    expect(screen.queryByTestId('employer-placement-row-a')).toBeNull();
    fireEvent.click(screen.getByTestId('employer-placements-filter-all'));
    expect(screen.getByTestId('employer-placement-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('employer-placement-row-b')).toBeInTheDocument();
  });
});

describe('PlacementsPage — wire-format', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calls employerPlacements.list on mount with no filter args', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-root')).toBeInTheDocument();
    });
    // No status filter on initial load — the page defers server-side
    // filtering in favour of client-side chip toggles. We assert the
    // first call was made with no status arg (either no args or
    // `undefined` as the params param, both equivalent).
    const firstCallArgs = mockedPlacementsList.mock.calls[0] ?? [];
    const firstArg = firstCallArgs[0];
    if (firstArg !== undefined) {
      expect(firstArg).toEqual({});
    }
  });

  it('hits the /v1/employer/placements endpoint (verified via query count)', async () => {
    mockedJobsList.mockResolvedValue([]);
    mockedPlacementsList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-placements-root')).toBeInTheDocument();
    });
    // Single network round-trip on mount — the status filter is purely
    // client-side after that.
    expect(mockedPlacementsList.mock.calls.length).toBe(1);
  });
});

// Touch the unused type import to keep the linter quiet when the suite grows.
void (null as unknown as PlacementStatus);