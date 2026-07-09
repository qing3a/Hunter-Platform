import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingClaimsPage } from '../PendingClaimsPage';
import { employerPendingClaims, type Job } from '../../../api/employer';

// ---- Mocks ---------------------------------------------------------------

vi.mock('../../../api/employer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/employer')>();
  return {
    ...actual,
    employerPendingClaims: {
      list: vi.fn(),
      claim: vi.fn(),
      reject: vi.fn(),
    },
  };
});

const mockedList = vi.mocked(employerPendingClaims.list);
const mockedClaim = vi.mocked(employerPendingClaims.claim);
const mockedReject = vi.mocked(employerPendingClaims.reject);

// ---- Helpers -------------------------------------------------------------

function makeClaim(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-claim-1',
    employer_id: null,
    source_headhunter_id: 'headhunter-alpha-001',
    created_for_employer_id: 'emp-1',
    title: 'Senior Backend Engineer',
    description: null,
    required_skills: ['TypeScript', 'Node.js'],
    salary_min: null,
    salary_max: null,
    status: 'open',
    priority: 'normal',
    deadline: null,
    industry: '互联网',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/employer/pending-claims']}>
        <PendingClaimsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ---------------------------------------------------------------

describe('PendingClaimsPage — loading + error', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading indicator while pending claims are in flight', () => {
    mockedList.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('employer-pending-claims-loading')).toBeInTheDocument();
  });

  it('renders an error banner when employerPendingClaims.list rejects', async () => {
    mockedList.mockRejectedValueOnce(new Error('加载失败'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claims-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-pending-claims-error')).toHaveTextContent('加载失败');
  });
});

describe('PendingClaimsPage — header + empty state', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the header title and pending count', async () => {
    mockedList.mockResolvedValue([
      makeClaim({ id: 'claim-a' }),
      makeClaim({ id: 'claim-b' }),
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claims-root')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-pending-claims-title')).toHaveTextContent('待领取工作');
    expect(screen.getByTestId('employer-pending-claims-count')).toHaveTextContent('2 个待领取');
  });

  it('shows an empty state when there are no pending claims', async () => {
    mockedList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claims-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-pending-claims-empty')).toHaveTextContent('暂无待领取工作');
  });
});

describe('PendingClaimsPage — list render', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a PendingClaimRow for each pending claim', async () => {
    mockedList.mockResolvedValue([
      makeClaim({ id: 'claim-a', title: 'Job A' }),
      makeClaim({ id: 'claim-b', title: 'Job B' }),
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claims-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-pending-claim-row-claim-a')).toHaveTextContent('Job A');
    expect(screen.getByTestId('employer-pending-claim-row-claim-b')).toHaveTextContent('Job B');
  });
});

describe('PendingClaimsPage — actions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calls employerPendingClaims.claim and refreshes the list after 领取', async () => {
    mockedList.mockResolvedValue([makeClaim({ id: 'claim-a' })]);
    mockedClaim.mockResolvedValue(makeClaim({ id: 'claim-a', employer_id: 'emp-1', status: 'claimed' }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claim-row-claim-a')).toBeInTheDocument();
    });
    const callsBefore = mockedList.mock.calls.length;
    fireEvent.click(
      within(screen.getByTestId('employer-pending-claim-row-claim-a')).getByTestId(
        'employer-pending-claim-action-claim',
      ),
    );

    await waitFor(() => {
      expect(mockedClaim).toHaveBeenCalledWith('claim-a');
    });
    await waitFor(() => {
      expect(mockedList.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('calls employerPendingClaims.reject and refreshes the list after 拒绝', async () => {
    mockedList.mockResolvedValue([makeClaim({ id: 'claim-a' })]);
    mockedReject.mockResolvedValue({ status: 'closed' });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claim-row-claim-a')).toBeInTheDocument();
    });
    const callsBefore = mockedList.mock.calls.length;
    fireEvent.click(
      within(screen.getByTestId('employer-pending-claim-row-claim-a')).getByTestId(
        'employer-pending-claim-action-reject',
      ),
    );

    await waitFor(() => {
      expect(mockedReject).toHaveBeenCalledWith('claim-a');
    });
    await waitFor(() => {
      expect(mockedList.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('renders an action error when claim/reject fails', async () => {
    mockedList.mockResolvedValue([makeClaim({ id: 'claim-a' })]);
    mockedClaim.mockRejectedValueOnce(new Error('已经被领取'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claim-row-claim-a')).toBeInTheDocument();
    });
    fireEvent.click(
      within(screen.getByTestId('employer-pending-claim-row-claim-a')).getByTestId(
        'employer-pending-claim-action-claim',
      ),
    );

    await waitFor(() => {
      expect(screen.getByTestId('employer-pending-claims-action-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-pending-claims-action-error')).toHaveTextContent('已经被领取');
  });
});
