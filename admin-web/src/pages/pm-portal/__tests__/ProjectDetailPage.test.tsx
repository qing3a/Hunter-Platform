import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectDetailPage } from '../ProjectDetailPage';
import { pmProjects, pmPositions, pmMatches } from '../../../api/pm-portal';
import {
  PROJECT_STATUS_LABELS,
  type ProjectSummary,
  type Position,
  type PositionStats,
  type MatchListItem,
} from '../../../api/pm-portal';

// ---- Mocks ----------------------------------------------------------------

// Capture navigation so we can assert on row-click → route transitions
// without spinning up a real router history.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

// Mock the PM API client. We importOriginal so the page can still resolve
// the label maps. Adding a new method to pmProjects/pmPositions is a
// no-op here until tests break intentionally (same pattern as
// ProjectsLibraryPage.test.tsx).
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
      create: vi.fn(),
      get: vi.fn(),
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
    pmDecompose: {
      decompose: vi.fn(),
      commit: vi.fn(),
      history: vi.fn(),
    },
    pmAuth: { requestOtp: vi.fn(), verifyOtp: vi.fn() },
  };
});

const mockedGetProject = vi.mocked(pmProjects.get);
const mockedListPositions = vi.mocked(pmPositions.list);
const mockedStatsPositions = vi.mocked(pmPositions.stats);
const mockedListMatches = vi.mocked(pmMatches.list);

// ---- Helpers --------------------------------------------------------------

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    pm_user_id: 'pm-1',
    name: 'AI Engineering Expansion',
    target: 'Hire 5 senior engineers by Q4',
    budget_total: 1_200_000_00,
    start_at: 1_700_000_000_000,
    end_at: 1_800_000_000_000,
    current_team: [
      { role: 'PM', count: 1 },
      { role: 'Engineer', count: 3 },
    ],
    status: 'active',
    position_count: 2,
    plan_count: 1,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    project_id: 'proj-1',
    title: 'Senior Frontend Engineer',
    description: null,
    required_skills: ['React', 'TypeScript'],
    title_level: 'senior',
    industry: 'FinTech',
    salary_min: 20000,
    salary_max: 40000,
    status: 'open',
    headcount_planned: 2,
    headcount_filled: 0,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makeStats(overrides: Partial<PositionStats> = {}): PositionStats {
  return {
    total: 2,
    open: 2,
    paused: 0,
    filled: 0,
    headcount_planned_total: 4,
    headcount_filled_total: 0,
    ...overrides,
  };
}

function makeMatch(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    match_id: 1,
    position_id: 'pos-1',
    candidate_user_id: 'cand-1',
    score: 92,
    reasons: ['React', '5y exp'],
    gaps: [],
    created_at: 1_700_000_000_000,
    candidate_display_name: '张*三',
    headline: null,
    ...overrides,
  };
}

function renderPage(projectId = 'proj-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/pm/projects/${projectId}`]}>
        <Routes>
          <Route path="/admin/pm/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPositions.mockReset();
    mockedStatsPositions.mockReset();
    mockedListMatches.mockReset();
  });

  it('shows a loading state while the project request is in flight', () => {
    mockedGetProject.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('pm-detail-loading')).toBeInTheDocument();
  });

  it('renders an error banner when pmProjects.get rejects', async () => {
    mockedGetProject.mockRejectedValueOnce(new Error('网络异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-detail-error')).toHaveTextContent('网络异常');
  });

  it('renders the project header with name, status, target, budget, dates, team', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: {
        total_positions: 0,
        filled_positions: 0,
        total_plans: 1,
        selected_plan_id: 'plan-default',
      },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats());
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-header'));

    const header = screen.getByTestId('pm-detail-header');
    expect(within(header).getByText('AI Engineering Expansion')).toBeInTheDocument();
    expect(within(header).getByText(PROJECT_STATUS_LABELS.active)).toBeInTheDocument();
    expect(within(header).getByText('Hire 5 senior engineers by Q4')).toBeInTheDocument();
    // Budget: 1.2M fen = 12,000,000 yuan = 120万
    expect(within(header).getByTestId('pm-detail-budget')).toHaveTextContent('¥120.0万');
    // Team: 2 roles, total 4 people
    expect(within(header).getByTestId('pm-detail-team')).toHaveTextContent('PM × 1');
    expect(within(header).getByTestId('pm-detail-team')).toHaveTextContent('Engineer × 3');
  });

  it('renders the S2 action bar with three buttons (metadata / compare / sandbox)', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 1, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-actionbar'));

    const actionbar = screen.getByTestId('pm-detail-actionbar');
    expect(within(actionbar).getByTestId('pm-detail-action-metadata')).toHaveTextContent('项目元数据');
    expect(within(actionbar).getByTestId('pm-detail-action-compare')).toHaveTextContent('方案对比');
    expect(within(actionbar).getByTestId('pm-detail-action-sandbox')).toHaveTextContent('沙盘');
  });

  it('renders the S2 grid layout (1fr + 320px) with PositionTable in the left column', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [makePosition()],
      plans: [],
      stats: { total_positions: 1, filled_positions: 0, total_plans: 1, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats());
    mockedListPositions.mockResolvedValueOnce({
      positions: [makePosition()],
      total: 1,
    });
    mockedListMatches.mockResolvedValueOnce({ matches: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-s2-grid'));

    const grid = screen.getByTestId('pm-s2-grid');
    // PositionTable is in the left (s2-main) column.
    expect(within(grid).getByTestId('pm-s2-main')).toBeInTheDocument();
    expect(within(within(grid).getByTestId('pm-s2-main')).getByTestId('pm-positions-table')).toBeInTheDocument();
    // MatchSidebar is in the right column.
    expect(within(grid).getByTestId('pm-s2-match-sidebar')).toBeInTheDocument();
  });

  it('renders the MatchSidebar with current position matches (top 4)', async () => {
    const position = makePosition({ id: 'pos-99', title: 'Tech Lead' });
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [position],
      plans: [],
      stats: { total_positions: 1, filled_positions: 0, total_plans: 1, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats());
    mockedListPositions.mockResolvedValueOnce({ positions: [position], total: 1 });
    mockedListMatches.mockResolvedValueOnce({
      matches: [
        makeMatch({ match_id: 1, position_id: 'pos-99', score: 92 }),
        makeMatch({ match_id: 2, position_id: 'pos-99', score: 85 }),
        makeMatch({ match_id: 3, position_id: 'pos-99', score: 70 }),
        makeMatch({ match_id: 4, position_id: 'pos-99', score: 60 }),
      ],
      total: 4,
    });

    renderPage();
    // Wait for the lazy pmMatches.list query to resolve and at least
    // one row to render. The sidebar mounts before the matches load
    // (it shows the empty state during the loading window). All four
    // matches share the same position_id, so use getAllByTestId to
    // count them.
    await waitFor(() => screen.getAllByTestId('pm-s2-match-row-pos-99'));

    const sidebar = screen.getByTestId('pm-s2-match-sidebar');
    const rows = within(sidebar).getAllByTestId('pm-s2-match-row-pos-99');
    expect(rows).toHaveLength(4);
    // The highest-scoring row surfaces the position title and project
    // name (server returns matches sorted by score DESC).
    expect(rows[0]).toHaveTextContent('92');
    expect(rows[0]).toHaveTextContent('Tech Lead');
    expect(rows[0]).toHaveTextContent('AI Engineering Expansion');
    // The empty state is no longer present.
    expect(within(sidebar).queryByTestId('pm-s2-match-empty')).toBeNull();
  });

  it('MatchSidebar shows empty state when no matches exist', async () => {
    const position = makePosition({ id: 'pos-99' });
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [position],
      plans: [],
      stats: { total_positions: 1, filled_positions: 0, total_plans: 1, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats());
    mockedListPositions.mockResolvedValueOnce({ positions: [position], total: 1 });
    mockedListMatches.mockResolvedValueOnce({ matches: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-s2-match-empty'));

    expect(screen.getByTestId('pm-s2-match-empty')).toHaveTextContent('暂无匹配');
  });

  it('navigates to the plan-comparison page when 方案对比 is clicked', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-action-compare'));

    fireEvent.click(screen.getByTestId('pm-detail-action-compare'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects/proj-1/compare');
  });

  it('navigates to the first position sandbox when 沙盘 is clicked', async () => {
    const first = makePosition({ id: 'pos-first' });
    const second = makePosition({ id: 'pos-second' });
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [first, second],
      plans: [],
      stats: { total_positions: 2, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats());
    mockedListPositions.mockResolvedValueOnce({ positions: [first, second], total: 2 });
    mockedListMatches.mockResolvedValueOnce({ matches: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-action-sandbox'));

    fireEvent.click(screen.getByTestId('pm-detail-action-sandbox'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects/proj-1/positions/pos-first/sandbox');
  });

  it('falls back to /admin/pm/snapshot for 沙盘 when the project has no positions', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-action-sandbox'));

    fireEvent.click(screen.getByTestId('pm-detail-action-sandbox'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/snapshot');
  });

  it('navigates back to /admin/pm/projects when the back button is clicked', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-back'));

    fireEvent.click(screen.getByTestId('pm-detail-back'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects');
  });

  it('overview section shows position stats + plan count + recent positions', async () => {
    const recent = makePosition({
      id: 'p-new',
      title: 'Tech Lead',
      created_at: Date.now() - 86_400_000, // 1 day ago
    });
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [recent],
      plans: [],
      stats: { total_positions: 1, filled_positions: 0, total_plans: 2, selected_plan_id: null },
    });
    // Override ALL the fields the test cares about so we don't depend on
    // the makeStats() defaults (e.g. default `open: 2` would fail the
    // `open: 1` assertion below).
    mockedStatsPositions.mockResolvedValueOnce(
      makeStats({
        total: 1,
        open: 1,
        paused: 0,
        filled: 0,
        headcount_planned_total: 2,
        headcount_filled_total: 0,
      }),
    );
    mockedListPositions.mockResolvedValueOnce({ positions: [recent], total: 1 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-overview'));

    const overview = screen.getByTestId('pm-detail-overview');
    // The overview renders stat tiles for total / open / paused / filled.
    expect(within(overview).getByTestId('pm-detail-stat-total')).toHaveTextContent('1');
    expect(within(overview).getByTestId('pm-detail-stat-open')).toHaveTextContent('1');
    expect(within(overview).getByTestId('pm-detail-stat-headcount')).toHaveTextContent('0 / 2');
    expect(within(overview).getByTestId('pm-detail-stat-plans')).toHaveTextContent('2');
  });

  it('renders the 智能拆岗位 button in the left column', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-s2-main'));

    const aiButton = screen.getByTestId('pm-detail-ai-decompose');
    expect(aiButton).toBeInTheDocument();
    expect(aiButton).toHaveTextContent('智能拆岗位');
  });

  it('opens the AI decompose modal when the 智能拆岗位 button is clicked', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    const { pmDecompose: mockedPmDecompose } = await import('../../../api/pm-portal');
    // Keep the call pending — assertions verify the loading state.
    vi.mocked(mockedPmDecompose.decompose).mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-ai-decompose'));

    fireEvent.click(screen.getByTestId('pm-detail-ai-decompose'));

    // Loading state of AIDecomposeModal is the visible contract.
    expect(screen.getByTestId('pm-decompose-modal')).toBeInTheDocument();
    expect(screen.getByTestId('pm-decompose-loading')).toBeInTheDocument();
  });

  it('closes the AI decompose modal when the × button is clicked', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    const { pmDecompose: mockedPmDecompose } = await import('../../../api/pm-portal');
    vi.mocked(mockedPmDecompose.decompose).mockResolvedValue({
      decomposition: {
        id: 'decomp-1',
        project_id: 'proj-1',
        source_text: 'vue frontend',
        positions_json: [{
          title: '高级前端工程师',
          skills: ['vue'],
          title_level: 'senior',
          headcount: 1,
          rationale: '匹配关键词: vue',
        }],
        source: 'ai_heuristic',
        created_at: 1,
      },
      suggestions: [{
        title: '高级前端工程师',
        skills: ['vue'],
        title_level: 'senior',
        headcount: 1,
        rationale: '匹配关键词: vue',
      }],
    });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-ai-decompose'));

    fireEvent.click(screen.getByTestId('pm-detail-ai-decompose'));
    // Wait for the preview to render so the close × button is mounted.
    await waitFor(() => screen.getByTestId('pm-decompose-modal-close'));

    fireEvent.click(screen.getByTestId('pm-decompose-modal-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('pm-decompose-modal')).toBeNull();
    });
  });
});
