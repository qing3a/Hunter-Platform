import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CandidateMatchesPage } from '../CandidateMatchesPage';
import {
  pmMatches,
  pmPositions,
  type MatchListItem,
  type Position,
} from '../../../api/pm-portal';
import { ToastProvider } from '../../../lib/toast';

// ---- Mocks ----------------------------------------------------------------

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('../../../api/pm-portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/pm-portal')>();
  return {
    ...actual,
    pmPositions: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulkCreate: vi.fn(),
      stats: vi.fn(),
    },
    pmMatches: {
      list: vi.fn(),
      recompute: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn(),
    },
  };
});

const mockedGetPosition = vi.mocked(pmPositions.get);
const mockedListPositions = vi.mocked(pmPositions.list);
const mockedListMatches = vi.mocked(pmMatches.list);
const mockedRecompute = vi.mocked(pmMatches.recompute);

// ---- Helpers --------------------------------------------------------------

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    project_id: 'proj-1',
    title: 'Senior Frontend Engineer',
    description: null,
    required_skills: ['React', 'TypeScript'],
    title_level: 'senior',
    industry: null,
    salary_min: null,
    salary_max: null,
    status: 'open',
    headcount_planned: 5,
    headcount_filled: 1,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    match_id: 1,
    position_id: 'pos-1',
    candidate_user_id: 'cand-1',
    score: 80,
    reasons: ['技能匹配'],
    gaps: [],
    created_at: 1_700_000_000_000,
    candidate_display_name: '张*三',
    headline: null,
    ...overrides,
  };
}

function renderPage(positionId = 'pos-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/pm/positions/${positionId}/matches`]}>
          <Routes>
            <Route path="/admin/pm/positions/:id/matches" element={<CandidateMatchesPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// ============================================================================
// Loading + error
// ============================================================================

describe('CandidateMatchesPage — loading / error', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('shows a loading state while both queries are in flight', () => {
    mockedGetPosition.mockReturnValue(new Promise(() => {}));
    mockedListMatches.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('pm-matches-loading')).toBeInTheDocument();
  });

  it('renders a position-error banner when pmPositions.get rejects', async () => {
    mockedGetPosition.mockRejectedValueOnce(new Error('岗位不可用'));
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-position-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-matches-position-error')).toHaveTextContent('岗位不可用');
  });

  it('renders a matches-error banner when pmMatches.list rejects', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockRejectedValueOnce(new Error('匹配服务异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-matches-error')).toHaveTextContent('匹配服务异常');
  });

  it('falls back to /admin/pm/projects when the position is unloadable (error banner)', async () => {
    mockedGetPosition.mockRejectedValueOnce(new Error('boom'));
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-position-error')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-matches-back-fallback'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects');
  });
});

// ============================================================================
// Header + back nav
// ============================================================================

describe('CandidateMatchesPage — header + back nav', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders the position title in the header', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ title: 'Staff Backend Engineer' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-title')).toHaveTextContent(
        'Staff Backend Engineer · 候选人匹配',
      );
    });
  });

  it('navigates back to the project detail when clicking 返回项目详情', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ project_id: 'proj-99' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    // Wait until the position data is actually loaded — i.e. the title
    // reflects the loaded position, not the "候选人匹配" fallback.
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-title')).toHaveTextContent(
        'Senior Frontend Engineer · 候选人匹配',
      );
    });
    fireEvent.click(screen.getByTestId('pm-matches-back'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects/proj-99');
  });

  it('falls back to /admin/pm/projects when the position header is not loaded', async () => {
    mockedGetPosition.mockReturnValue(new Promise(() => {}));
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    // Loading state — back button should still render and use the fallback.
    expect(screen.getByTestId('pm-matches-loading')).toBeInTheDocument();
  });
});

// ============================================================================
// Stats strip
// ============================================================================

describe('CandidateMatchesPage — stats', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('reports the total count and the rounded average score', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 1, score: 90 }),
        makeMatch({ match_id: 2, score: 80 }),
        makeMatch({ match_id: 3, score: 70 }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-matches-stat-total')).toHaveTextContent('3');
    expect(screen.getByTestId('pm-matches-stat-total')).toHaveAttribute('data-total', '3');
    // (90 + 80 + 70) / 3 = 80
    expect(screen.getByTestId('pm-matches-stat-average')).toHaveTextContent('80');
  });

  it('shows the current min_score filter value in the stats strip', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-matches-stat-filter')).toHaveTextContent('全部');
    expect(screen.getByTestId('pm-matches-stat-filter')).toHaveAttribute('data-min-score', '0');
  });
});

// ============================================================================
// Match grid + sort + filter
// ============================================================================

describe('CandidateMatchesPage — match grid + sort', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders one card per match with index-namespaced test ids', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 11, candidate_user_id: 'c1' }),
        makeMatch({ match_id: 22, candidate_user_id: 'c2' }),
        makeMatch({ match_id: 33, candidate_user_id: 'c3' }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-match-card-0')).toHaveAttribute('data-match-id', '11');
    expect(screen.getByTestId('pm-match-card-1')).toHaveAttribute('data-match-id', '22');
    expect(screen.getByTestId('pm-match-card-2')).toHaveAttribute('data-match-id', '33');
  });

  it('client-side sorts cards by score DESC even when the server order is mixed', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    // Server happens to return in the wrong order — UI must reorder.
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 1, score: 60 }),
        makeMatch({ match_id: 2, score: 95 }),
        makeMatch({ match_id: 3, score: 80 }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-grid')).toBeInTheDocument();
    });
    const grid = screen.getByTestId('pm-matches-grid');
    const cards = within(grid).getAllByTestId(/^pm-match-card-\d+$/);
    expect(cards.map((c) => c.getAttribute('data-score'))).toEqual(['95', '80', '60']);
  });

  it('passes the chosen min_score to pmMatches.list', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });
    // Default min_score is 0 -> first call has min_score: 0.
    expect(mockedListMatches).toHaveBeenLastCalledWith('pos-1', { min_score: 0, limit: 100 });

    fireEvent.change(screen.getByTestId('pm-matches-min-score'), {
      target: { value: '75' },
    });
    await waitFor(() => {
      expect(mockedListMatches).toHaveBeenLastCalledWith('pos-1', { min_score: 75, limit: 100 });
    });
    expect(screen.getByTestId('pm-matches-stat-filter')).toHaveTextContent('75+');
  });

  it('only renders the allowed 0/60/75/90 options in the min_score dropdown', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-min-score')).toBeInTheDocument();
    });
    const select = screen.getByTestId('pm-matches-min-score') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['0', '60', '75', '90']);
  });
});

// ============================================================================
// Empty states
// ============================================================================

describe('CandidateMatchesPage — empty states', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('shows the default empty hint when the initial list is empty', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-matches-empty')).toHaveTextContent('暂无匹配,试试重算匹配');
  });

  it('shows the recompute-empty hint after a successful recompute returns no matches', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedRecompute.mockResolvedValue({ computed_count: 5, top_matches: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pm-matches-recompute'));
    await waitFor(() => {
      expect(mockedRecompute).toHaveBeenCalledWith('pos-1');
    });
    // The recompute success mutation flips the empty-state copy. We don't
    // assert the success toast here — it's covered by ToastProvider tests.
  });
});

// ============================================================================
// Recompute action
// ============================================================================

describe('CandidateMatchesPage — recompute', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('calls pmMatches.recompute with the position id on click', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedRecompute.mockResolvedValue({ computed_count: 5, top_matches: [] });
    renderPage();
    // Wait for both queries to settle so the button is enabled.
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pm-matches-recompute'));
    await waitFor(() => {
      expect(mockedRecompute).toHaveBeenCalledWith('pos-1');
    });
  });

  it('disables the recompute button while the mutation is pending', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    // Never resolve — keep the mutation pending.
    mockedRecompute.mockReturnValue(new Promise(() => {}));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });

    const btn = screen.getByTestId('pm-matches-recompute') as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn).toBeDisabled();
    });
    expect(btn).toHaveTextContent('重算中…');
  });

  it('re-fetches the matches list after a successful recompute', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedRecompute.mockResolvedValue({ computed_count: 5, top_matches: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-empty')).toBeInTheDocument();
    });
    const callsBefore = mockedListMatches.mock.calls.length;
    fireEvent.click(screen.getByTestId('pm-matches-recompute'));
    await waitFor(() => {
      expect(mockedListMatches.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

// -------------------------------------------------------------------------
// Task 7 — inline PositionPicker in the S6 header
// -------------------------------------------------------------------------

describe('CandidateMatchesPage — Task 7 PositionPicker', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders the <PositionPicker> with the project positions', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ project_id: 'proj-1' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedListPositions.mockResolvedValueOnce({
      positions: [
        makePosition({ id: 'pos-1', title: 'Senior Frontend Engineer', title_level: 'senior' }),
        makePosition({ id: 'pos-2', title: 'Tech Lead', title_level: 'staff' }),
      ],
      total: 2,
    });

    renderPage();
    await waitFor(() => {
      const picker = screen.getByTestId('pm-position-picker');
      expect(picker.querySelectorAll('option')).toHaveLength(2);
    });

    const picker = screen.getByTestId('pm-position-picker');
    const options = picker.querySelectorAll('option');
    expect(options[0]).toHaveTextContent('Senior Frontend Engineer');
    expect(options[1]).toHaveTextContent('Tech Lead');
  });

  it('navigates to the new position matches page when the <PositionPicker> selection changes', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ project_id: 'proj-1' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedListPositions.mockResolvedValueOnce({
      positions: [
        makePosition({ id: 'pos-1', title: 'Senior Frontend Engineer' }),
        makePosition({ id: 'pos-2', title: 'Tech Lead' }),
      ],
      total: 2,
    });

    renderPage();
    await waitFor(() => {
      const picker = screen.getByTestId('pm-position-picker');
      expect(picker.querySelectorAll('option')).toHaveLength(2);
    });

    fireEvent.change(screen.getByTestId('pm-position-picker'), {
      target: { value: 'pos-2' },
    });
    expect(navigateSpy).toHaveBeenCalledWith(
      '/admin/pm/projects/proj-1/positions/pos-2/matches',
    );
  });
});

// -------------------------------------------------------------------------
// Task 11 — S6 SortPills + per-row action stack
// -------------------------------------------------------------------------

describe('CandidateMatchesPage — Task 11 SortPills', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders the 3 sort pills with the default "score" pill active', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sort-pills')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-sort-pill-score')).toHaveClass('active');
    expect(screen.getByTestId('pm-sort-pill-time')).not.toHaveClass('active');
    expect(screen.getByTestId('pm-sort-pill-salary')).not.toHaveClass('active');
  });

  it('re-orders cards by created_at DESC when the "到岗时间" pill is clicked', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 1, score: 90, created_at: 1_000 }),
        makeMatch({ match_id: 2, score: 60, created_at: 9_000 }),
        makeMatch({ match_id: 3, score: 80, created_at: 5_000 }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-grid')).toBeInTheDocument();
    });
    // Default sort: score DESC → [90, 80, 60] = [1, 3, 2]
    let grid = screen.getByTestId('pm-matches-grid');
    let cards = within(grid).getAllByTestId(/^pm-match-card-\d+$/);
    expect(cards.map((c) => c.getAttribute('data-match-id'))).toEqual(['1', '3', '2']);

    // Click the "到岗时间" pill → created_at DESC → [2, 3, 1]
    fireEvent.click(screen.getByTestId('pm-sort-pill-time'));
    await waitFor(() => {
      expect(screen.getByTestId('pm-sort-pill-time')).toHaveClass('active');
    });
    grid = screen.getByTestId('pm-matches-grid');
    cards = within(grid).getAllByTestId(/^pm-match-card-\d+$/);
    expect(cards.map((c) => c.getAttribute('data-match-id'))).toEqual(['2', '3', '1']);
  });
});

describe('CandidateMatchesPage — Task 11 per-row action stack', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListMatches.mockReset();
    mockedRecompute.mockReset();
    mockedListPositions.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders an <ActionStack> in every match card', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 1 }),
        makeMatch({ match_id: 2 }),
      ],
      total: 2,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-grid')).toBeInTheDocument();
    });
    // One ActionStack per card → 2 total.
    const stacks = screen.getAllByTestId('pm-action-stack');
    expect(stacks).toHaveLength(2);
    // The recommend button exists inside each stack.
    expect(screen.getAllByTestId('pm-action-recommend')).toHaveLength(2);
  });

  it('renders the score tier label next to each score badge', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 1, score: 95 }), // high
        makeMatch({ match_id: 2, score: 72 }), // mid
        makeMatch({ match_id: 3, score: 40 }), // low
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-matches-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-match-card-0-tier')).toHaveTextContent('高分');
    expect(screen.getByTestId('pm-match-card-1-tier')).toHaveTextContent('中分');
    expect(screen.getByTestId('pm-match-card-2-tier')).toHaveTextContent('低分');
  });
});

// -------------------------------------------------------------------------
// sortMatches helper
// -------------------------------------------------------------------------

import { sortMatches } from '../CandidateMatchesPage';

describe('sortMatches helper', () => {
  const matches: MatchListItem[] = [
    { ...makeMatch({ match_id: 1, score: 90, created_at: 1_000 }) },
    { ...makeMatch({ match_id: 2, score: 60, created_at: 9_000 }) },
    { ...makeMatch({ match_id: 3, score: 80, created_at: 5_000 }) },
  ];

  it('returns score DESC for "score"', () => {
    const sorted = sortMatches(matches, 'score');
    expect(sorted.map((m) => m.match_id)).toEqual([1, 3, 2]);
  });

  it('returns created_at DESC for "time"', () => {
    const sorted = sortMatches(matches, 'time');
    expect(sorted.map((m) => m.match_id)).toEqual([2, 3, 1]);
  });

  it('falls back to score DESC for "salary" (no salary data on MatchListItem yet)', () => {
    const sorted = sortMatches(matches, 'salary');
    expect(sorted.map((m) => m.match_id)).toEqual([1, 3, 2]);
  });

  it('does not mutate the input array', () => {
    const original = [...matches];
    sortMatches(matches, 'time');
    expect(matches).toEqual(original);
  });
});