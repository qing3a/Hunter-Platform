import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CandidateDetailPage } from '../CandidateDetailPage';
import {
  pmMatches,
  pmNotes,
  pmPositions,
  pmProjects,
  type MatchListItem,
  type PmPrivateNote,
  type Position,
  type ProjectSummary,
} from '../../../api/pm-portal';
import { ToastProvider } from '@hunter-platform/shared-web/lib';

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
    pmProjects: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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
    pmNotes: {
      get: vi.fn(),
      update: vi.fn(),
    },
  };
});

const mockedListProjects = vi.mocked(pmProjects.list);
const mockedListPositions = vi.mocked(pmPositions.list);
const mockedListMatches = vi.mocked(pmMatches.list);
const mockedNotesGet = vi.mocked(pmNotes.get);

// ---- Helpers --------------------------------------------------------------

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    pm_user_id: 'pm-1',
    name: 'ProjectA',
    target: null,
    budget_total: null,
    start_at: null,
    end_at: null,
    current_team: null,
    status: 'active',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    position_count: 2,
    plan_count: 1,
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    project_id: 'proj-1',
    title: '高级前端工程师',
    description: null,
    required_skills: ['vue', 'typescript'],
    title_level: 'senior',
    industry: null,
    salary_min: null,
    salary_max: null,
    status: 'open',
    headcount_planned: 3,
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

function makeNote(overrides: Partial<PmPrivateNote> = {}): PmPrivateNote {
  return {
    starred: false,
    note_text: '',
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderPage(userId = 'cand-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/pm/candidates/${userId}`]}>
          <Routes>
            <Route path="/admin/pm/candidates/:userId" element={<CandidateDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// ============================================================================
// Loading / error states
// ============================================================================

describe('CandidateDetailPage — loading + error', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('shows a loading state while projects are in flight', () => {
    mockedListProjects.mockReturnValue(new Promise(() => {}));
    mockedListPositions.mockReturnValue(new Promise(() => {}));
    mockedListMatches.mockReturnValue(new Promise(() => {}));
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    expect(screen.getByTestId('pm-candidate-detail-loading')).toBeInTheDocument();
  });

  it('renders a project-error banner when pmProjects.list rejects', async () => {
    mockedListProjects.mockRejectedValueOnce(new Error('项目不可用'));
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-candidate-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-candidate-detail-error')).toHaveTextContent('项目不可用');
  });

  it('falls back to /admin/pm/projects from the error banner', async () => {
    mockedListProjects.mockRejectedValueOnce(new Error('boom'));
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-candidate-detail-error')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-candidate-detail-back-fallback'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects');
  });
});

// ============================================================================
// Header (back + title + candidate picker)
// ============================================================================

describe('CandidateDetailPage — header', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('renders the title 候选人详情 in the header', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-candidate-detail-title')).toHaveTextContent(
        '候选人详情',
      );
    });
  });

  it('returns the user back via navigate(-1) on the back button', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-candidate-detail-title')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-candidate-detail-back'));
    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });
});

// ============================================================================
// PMViewBanner (S5 disclaimer)
// ============================================================================

describe('CandidateDetailPage — PM view banner', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('renders the PM 视角 banner at the top of the page', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getByTestId('pm-view-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-view-banner')).toHaveTextContent('PM 视角');
  });
});

// ============================================================================
// CandidateProfileCard (S5 left column)
// ============================================================================

describe('CandidateDetailPage — CandidateProfileCard', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('renders the demo candidate profile data inside pm-candidate-profile', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      const card = screen.getByTestId('pm-candidate-profile');
      expect(card).toHaveTextContent('张*三');
      expect(card).toHaveTextContent('高级前端工程师');
      expect(card).toHaveTextContent('某互联网大厂');
      expect(card).toHaveTextContent('内推');
    });
  });

  it('renders the disabled 解锁联系方式 button', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /解锁联系方式/ }),
      ).toBeDisabled();
    });
  });

  it('falls back to 匿名候选人 for an unknown candidate id', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-unknown');
    await waitFor(() => {
      expect(screen.getByTestId('pm-candidate-profile')).toHaveTextContent('匿名候选人');
    });
  });
});

// ============================================================================
// CandidateRadar + TierBadgeRow (S5 right column top)
// ============================================================================

describe('CandidateDetailPage — radar + tier badges', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('renders the SVG radar inside the right column', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      const card = screen.getByTestId('pm-candidate-radar');
      expect(card.querySelector('svg.cp-radar')).not.toBeNull();
    });
  });

  it('renders 5 tier badges (one per capability dimension)', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getAllByTestId('pm-tier-badge')).toHaveLength(5);
    });
  });
});

// ============================================================================
// MatchTableRow (S5 right column middle)
// ============================================================================

describe('CandidateDetailPage — match table rows', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('passes each project id into pmPositions.list and the candidate\'s matches through pmMatches.list', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const project2 = makeProject({ id: 'proj-2', name: 'ProjectB' });
    const pos1 = makePosition({ id: 'pos-1', project_id: 'proj-1', title: '高级前端工程师' });
    const pos2 = makePosition({
      id: 'pos-2',
      project_id: 'proj-2',
      title: '全栈工程师',
      required_skills: ['node.js'],
    });

    mockedListProjects.mockResolvedValue({ projects: [project1, project2], total: 2 });
    mockedListPositions.mockImplementation(async (projectId) => {
      if (projectId === 'proj-1') return { positions: [pos1], total: 1 };
      if (projectId === 'proj-2') return { positions: [pos2], total: 1 };
      return { positions: [], total: 0 };
    });
    mockedListMatches.mockImplementation(async (positionId) => {
      if (positionId === 'pos-1') {
        return {
          matches: [makeMatch({ match_id: 11, candidate_user_id: 'cand-1', score: 70 })],
          total: 1,
        };
      }
      if (positionId === 'pos-2') {
        return {
          matches: [makeMatch({ match_id: 22, position_id: 'pos-2', candidate_user_id: 'cand-1', score: 90 })],
          total: 1,
        };
      }
      return { matches: [], total: 0 };
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      expect(mockedListPositions).toHaveBeenCalledWith('proj-1', { limit: 100 });
      expect(mockedListPositions).toHaveBeenCalledWith('proj-2', { limit: 100 });
    });
    await waitFor(() => {
      expect(mockedListMatches).toHaveBeenCalledWith('pos-1', { min_score: 0, limit: 100 });
      expect(mockedListMatches).toHaveBeenCalledWith('pos-2', { min_score: 0, limit: 100 });
    });
  });

  it('renders one row per match for the route user, sorted by score DESC', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const pos1 = makePosition({ id: 'pos-1' });
    const pos2 = makePosition({ id: 'pos-2', title: '全栈工程师' });

    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1, pos2], total: 2 });
    mockedListMatches.mockImplementation(async (positionId) => {
      if (positionId === 'pos-1') {
        return {
          matches: [
            makeMatch({ match_id: 11, position_id: 'pos-1', score: 60 }),
            // A row belonging to a DIFFERENT candidate — must be filtered out.
            makeMatch({ match_id: 12, position_id: 'pos-1', candidate_user_id: 'cand-other', score: 95 }),
          ],
          total: 2,
        };
      }
      if (positionId === 'pos-2') {
        return {
          matches: [makeMatch({ match_id: 21, position_id: 'pos-2', candidate_user_id: 'cand-1', score: 90 })],
          total: 1,
        };
      }
      return { matches: [], total: 0 };
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getByTestId('pm-s5-match-table')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('pm-s5-match-row');
    // Two rows for cand-1: match_id 21 (score 90) and 11 (score 60).
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('90')).toBeInTheDocument();
    expect(within(rows[1]).getByText('60')).toBeInTheDocument();
  });

  it('updates the matches-count to reflect only the route candidate\'s matches', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const pos1 = makePosition({ id: 'pos-1' });
    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1], total: 1 });
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 11, score: 80 }),
        makeMatch({ match_id: 12, candidate_user_id: 'cand-other', score: 95 }),
      ],
      total: 2,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      const count = screen.getByTestId('pm-candidate-detail-matches-count');
      expect(count).toHaveAttribute('data-count', '1');
      expect(count).toHaveTextContent('共 1 个匹配');
    });
  });

  it('renders the empty-state when no rows match the candidate id', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const pos1 = makePosition({ id: 'pos-1' });
    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1], total: 1 });
    mockedListMatches.mockResolvedValue({
      matches: [makeMatch({ candidate_user_id: 'someone-else' })],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getByTestId('pm-candidate-detail-matches-empty')).toBeInTheDocument();
    });
  });

  it('sorts ties deterministically by match_id ASC after equal scores', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const pos1 = makePosition({ id: 'pos-1' });
    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1], total: 1 });
    // Server returned in score-equal but inverted id order.
    mockedListMatches.mockResolvedValue({
      matches: [
        makeMatch({ match_id: 33, score: 80 }),
        makeMatch({ match_id: 22, score: 80 }),
        makeMatch({ match_id: 11, score: 80 }),
      ],
      total: 3,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getByTestId('pm-s5-match-table')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('pm-s5-match-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('80')).toBeInTheDocument();
    expect(within(rows[1]).getByText('80')).toBeInTheDocument();
    expect(within(rows[2]).getByText('80')).toBeInTheDocument();
    // Pos titles should reflect pos-1's title for all three rows.
    expect(within(rows[0]).getByText('高级前端工程师')).toBeInTheDocument();
  });

  it('renders the project name and position title in each row', async () => {
    const project1 = makeProject({ id: 'proj-1', name: 'ProjectA' });
    const pos1 = makePosition({ id: 'pos-1' });
    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1], total: 1 });
    mockedListMatches.mockResolvedValue({
      matches: [makeMatch({ match_id: 1, position_id: 'pos-1', score: 80 })],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      const row = screen.getByTestId('pm-s5-match-row');
      expect(within(row).getByText('ProjectA')).toBeInTheDocument();
      expect(within(row).getByText('高级前端工程师')).toBeInTheDocument();
    });
  });

  it('renders the 推荐 button in the action cell', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const pos1 = makePosition({ id: 'pos-1' });
    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1], total: 1 });
    mockedListMatches.mockResolvedValue({
      matches: [makeMatch({ match_id: 1, score: 80 })],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getByTestId('pm-s5-row-recommend')).toBeInTheDocument();
      expect(screen.getByTestId('pm-s5-row-caution')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// PM private note section integration
// ============================================================================

describe('CandidateDetailPage — PM private note integration', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('renders the PrivateNoteCard section with the candidate label', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote({ note_text: '已联系, 等回复' }));

    renderPage('cand-1');
    await waitFor(() => {
      const card = screen.getByTestId('pm-private-note');
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute('data-candidate-user-id', 'cand-1');
    });
    // The note text returned by pmNotes.get should be reflected in the read-mode display.
    expect(await screen.findByTestId('pm-private-note-text')).toHaveTextContent(
      '已联系, 等回复',
    );
  });

  it('renders an empty-state for the note when the GET returns no text', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      expect(screen.getByTestId('pm-private-note-empty')).toBeInTheDocument();
    });
  });
});

// -------------------------------------------------------------------------
// Task 7 — inline candidate picker
// -------------------------------------------------------------------------

describe('CandidateDetailPage — Task 7 candidate picker', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedListProjects.mockReset();
    mockedListPositions.mockReset();
    mockedListMatches.mockReset();
    mockedNotesGet.mockReset();
  });

  it('renders the <select> candidate picker with the route candidate pre-selected', async () => {
    mockedListProjects.mockResolvedValue({ projects: [], total: 0 });
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
    mockedListMatches.mockResolvedValue({ matches: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => screen.getByTestId('pm-candidate-picker'));

    const picker = screen.getByTestId('pm-candidate-picker') as HTMLSelectElement;
    expect(picker.value).toBe('cand-1');
  });

  it('lists every deduped candidate across projects / positions', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const project2 = makeProject({ id: 'proj-2', name: 'ProjectB' });
    const pos1 = makePosition({ id: 'pos-1', project_id: 'proj-1' });
    const pos2 = makePosition({ id: 'pos-2', project_id: 'proj-2' });

    mockedListProjects.mockResolvedValue({ projects: [project1, project2], total: 2 });
    mockedListPositions.mockImplementation(async (projectId) => {
      if (projectId === 'proj-1') return { positions: [pos1], total: 1 };
      if (projectId === 'proj-2') return { positions: [pos2], total: 1 };
      return { positions: [], total: 0 };
    });
    mockedListMatches.mockImplementation(async (positionId) => {
      if (positionId === 'pos-1') {
        return {
          matches: [
            // cand-1 appears twice (in pos-1) — must be deduped.
            makeMatch({ match_id: 1, position_id: 'pos-1', candidate_user_id: 'cand-1', candidate_display_name: '张*三' }),
            makeMatch({ match_id: 2, position_id: 'pos-1', candidate_user_id: 'cand-1', candidate_display_name: '张*三' }),
            makeMatch({ match_id: 3, position_id: 'pos-1', candidate_user_id: 'cand-2', candidate_display_name: '李*四' }),
          ],
          total: 3,
        };
      }
      if (positionId === 'pos-2') {
        return {
          matches: [
            makeMatch({ match_id: 4, position_id: 'pos-2', candidate_user_id: 'cand-3', candidate_display_name: '王*五' }),
          ],
          total: 1,
        };
      }
      return { matches: [], total: 0 };
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      const picker = screen.getByTestId('pm-candidate-picker');
      expect(picker.querySelectorAll('option')).toHaveLength(3);
    });

    const picker = screen.getByTestId('pm-candidate-picker');
    const options = picker.querySelectorAll('option');
    // Sorted by user_id ASC: cand-1, cand-2, cand-3
    const values = Array.from(options).map((o) => o.value);
    expect(values).toEqual(['cand-1', 'cand-2', 'cand-3']);
  });

  it('navigates to the new candidate detail URL on change', async () => {
    const project1 = makeProject({ id: 'proj-1' });
    const pos1 = makePosition({ id: 'pos-1' });
    mockedListProjects.mockResolvedValue({ projects: [project1], total: 1 });
    mockedListPositions.mockResolvedValue({ positions: [pos1], total: 1 });
    mockedListMatches.mockImplementation(async () => ({
      matches: [
        makeMatch({ match_id: 1, position_id: 'pos-1', candidate_user_id: 'cand-1', candidate_display_name: '张*三' }),
        makeMatch({ match_id: 2, position_id: 'pos-1', candidate_user_id: 'cand-2', candidate_display_name: '李*四' }),
      ],
      total: 2,
    }));
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage('cand-1');
    await waitFor(() => {
      const picker = screen.getByTestId('pm-candidate-picker');
      expect(picker.querySelectorAll('option')).toHaveLength(2);
    });

    fireEvent.change(screen.getByTestId('pm-candidate-picker'), {
      target: { value: 'cand-2' },
    });
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/candidates/cand-2');
  });
});
