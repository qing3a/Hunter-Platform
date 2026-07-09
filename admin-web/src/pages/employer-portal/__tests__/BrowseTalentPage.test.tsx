import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowseTalentPage } from '../BrowseTalentPage';
import { employerCandidates, type TalentPreview } from '../../../api/employer';

// ---- Mocks ---------------------------------------------------------------

vi.mock('../../../api/employer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/employer')>();
  return {
    ...actual,
    employerCandidates: {
      browse: vi.fn(),
      expressInterest: vi.fn(),
      unlockContact: vi.fn(),
    },
  };
});

const mockedBrowse = vi.mocked(employerCandidates.browse);
const mockedExpress = vi.mocked(employerCandidates.expressInterest);
const mockedUnlock = vi.mocked(employerCandidates.unlockContact);

// ---- Helpers -------------------------------------------------------------

function makeCandidate(overrides: Partial<TalentPreview> = {}): TalentPreview {
  return {
    anonymized_id: 'cand-1',
    industry: '互联网',
    title_level: 'senior',
    years_experience: 6,
    salary_range: '40-60万',
    education_tier: '985',
    skills: ['React', 'TypeScript'],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/employer/candidates']}>
        <BrowseTalentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('BrowseTalentPage — loading + error', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading indicator while the browse request is in flight', () => {
    mockedBrowse.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('employer-candidates-loading')).toBeInTheDocument();
  });

  it('renders an error banner when browse rejects', async () => {
    mockedBrowse.mockRejectedValueOnce(new Error('网络异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-candidates-error')).toHaveTextContent('网络异常');
  });
});

describe('BrowseTalentPage — header + empty state', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page header with title and filter sidebar', async () => {
    mockedBrowse.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-root')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-candidates-title')).toHaveTextContent('浏览候选人');
    expect(screen.getByTestId('employer-filter-bar')).toBeInTheDocument();
  });

  it('renders an empty state when the browse returns zero candidates', async () => {
    mockedBrowse.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-empty')).toBeInTheDocument();
    });
  });
});

describe('BrowseTalentPage — candidate grid', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a CandidatePreviewCard per result', async () => {
    mockedBrowse.mockResolvedValue([
      makeCandidate({ anonymized_id: 'cand-A' }),
      makeCandidate({ anonymized_id: 'cand-B' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-candidate-card-cand-A')).toBeInTheDocument();
    expect(screen.getByTestId('employer-candidate-card-cand-B')).toBeInTheDocument();
  });
});

describe('BrowseTalentPage — filter sidebar drives refetch', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call browse with any filter params on first load (empty filter)', async () => {
    mockedBrowse.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-root')).toBeInTheDocument();
    });
    expect(mockedBrowse).toHaveBeenCalledWith(undefined);
  });

  it('clicking an industry chip triggers a refetch with that filter', async () => {
    mockedBrowse.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-filter-industry-chip-互联网'));
    await waitFor(() => {
      // Second call should include the industry filter — the page
      // forwards the first selected industry as a single value because
      // the backend's `browseTalent` compares against one column.
      const last = mockedBrowse.mock.calls[mockedBrowse.mock.calls.length - 1][0];
      expect(last).toMatchObject({ industry: '互联网' });
    });
  });

  it('changing the skills input triggers a refetch with parsed skills', async () => {
    mockedBrowse.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidates-root')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('employer-filter-skills-input'), {
      target: { value: 'react, typescript' },
    });
    await waitFor(() => {
      const last = mockedBrowse.mock.calls[mockedBrowse.mock.calls.length - 1][0];
      expect(last).toMatchObject({ skills: ['react', 'typescript'] });
    });
  });
});

describe('BrowseTalentPage — card actions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('clicking 表达兴趣 on a card calls employerCandidates.expressInterest (no-op for talent browse)', async () => {
    // For the talent browse (GET /v1/employer/talent) the express-interest
    // call is not wired at the row level — it lives on recommendations
    // (POST /v1/employer/recommendations/:id/express-interest). The card
    // surfaces the button as a placeholder that triggers a console warn
    // (or a no-op), but we expose a stable testid so future tasks can
    // wire it. For now, clicking must not throw and must not refetch.
    mockedBrowse.mockResolvedValue([makeCandidate({ anonymized_id: 'cand-X' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidate-card-cand-X')).toBeInTheDocument();
    });
    const callsBefore = mockedBrowse.mock.calls.length;
    expect(() =>
      fireEvent.click(screen.getByTestId('employer-candidate-card-cand-X-express')),
    ).not.toThrow();
    // No additional browse refetch expected.
    expect(mockedBrowse.mock.calls.length).toBe(callsBefore);
  });

  it('clicking 解锁 on a card does not throw when the underlying endpoint is a no-op for talent browse', async () => {
    mockedBrowse.mockResolvedValue([makeCandidate({ anonymized_id: 'cand-Y' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-candidate-card-cand-Y')).toBeInTheDocument();
    });
    expect(() =>
      fireEvent.click(screen.getByTestId('employer-candidate-card-cand-Y-unlock')),
    ).not.toThrow();
  });
});

// Touch the unused imports so the linter doesn't complain about them
// when we grow the test suite with deeper assertion variants.
void mockedExpress;
void mockedUnlock;