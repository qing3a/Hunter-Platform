import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectDetailPage } from '../ProjectDetailPage';
import { pmProjects, pmPositions } from '../../../api/pm-portal';
import {
  PROJECT_STATUS_LABELS,
  type ProjectSummary,
  type Position,
  type PositionStats,
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
    pmAuth: { requestOtp: vi.fn(), verifyOtp: vi.fn() },
  };
});

const mockedGetProject = vi.mocked(pmProjects.get);
const mockedListPositions = vi.mocked(pmPositions.list);
const mockedStatsPositions = vi.mocked(pmPositions.stats);

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

function renderPage(projectId = 'proj-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/pm/projects/${projectId}`]}>
        <Routes>
          <Route path="/pm/projects/:id" element={<ProjectDetailPage />} />
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

  it('renders four tabs: 概览 / 岗位 / 计划 / 匹配', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 1, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    const tabs = within(screen.getByTestId('pm-detail-tabs')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['概览', '岗位', '计划', '匹配']);
  });

  it('starts on the Overview tab by default', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 1, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    const overviewTab = within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '概览' });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    // Overview content (stats cards) is visible.
    expect(screen.getByTestId('pm-detail-overview')).toBeInTheDocument();
  });

  it('switches to the Positions tab and shows the PositionTable', async () => {
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

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '岗位' }));
    // The lazy pmPositions.list query is now enabled; wait for the
    // rendered table rather than relying on a fixed flush().
    await waitFor(() => {
      expect(screen.getByTestId('pm-positions-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-position-row')).toBeInTheDocument();
  });

  it('Overview tab shows position stats + plan count + recent positions', async () => {
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

  it('switches to the Plans tab and shows a placeholder', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '计划' }));
    expect(screen.getByTestId('pm-detail-plans-placeholder')).toBeInTheDocument();
    expect(screen.getByText(/Plans — coming in Task 7/)).toBeInTheDocument();
  });

  it('switches to the Matches tab and shows a placeholder', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '匹配' }));
    expect(screen.getByTestId('pm-detail-matches-placeholder')).toBeInTheDocument();
    expect(screen.getByText(/Matches — coming in Task 10/)).toBeInTheDocument();
  });

  it('renders the "智能拆岗位" button on the Positions tab', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '岗位' }));
    expect(screen.getByTestId('pm-detail-ai-decompose')).toBeInTheDocument();
    expect(screen.getByTestId('pm-detail-ai-decompose')).toHaveTextContent('智能拆岗位');
  });

  it('opens a placeholder modal when the "智能拆岗位" button is clicked', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '岗位' }));
    fireEvent.click(screen.getByTestId('pm-detail-ai-decompose'));

    expect(screen.getByTestId('pm-detail-ai-decompose-modal')).toBeInTheDocument();
    expect(screen.getByText(/AI 拆岗 — coming in Task 6/)).toBeInTheDocument();
  });

  it('closes the AI decompose modal when the close button is clicked', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '岗位' }));
    fireEvent.click(screen.getByTestId('pm-detail-ai-decompose'));
    expect(screen.getByTestId('pm-detail-ai-decompose-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pm-detail-ai-decompose-modal-close'));
    expect(screen.queryByTestId('pm-detail-ai-decompose-modal')).toBeNull();
  });

  it('PositionTable row click logs the position id (placeholder for detail navigation)', async () => {
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [makePosition({ id: 'pos-x' })],
      plans: [],
      stats: { total_positions: 1, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats());
    mockedListPositions.mockResolvedValueOnce({
      positions: [makePosition({ id: 'pos-x' })],
      total: 1,
    });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-tabs'));

    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '岗位' }));
    await waitFor(() => {
      expect(screen.getByTestId('pm-positions-table')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pm-position-row'));
    // The onRowClick callback in ProjectDetailPage is a no-op (placeholder
    // for the position detail page in a later task). We assert the table
    // is still visible after the click so the user doesn't get booted.
    expect(screen.getByTestId('pm-positions-table')).toBeInTheDocument();
  });

  it('navigates back to /pm/projects when the back button is clicked', async () => {
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
    expect(navigateSpy).toHaveBeenCalledWith('/pm/projects');
  });

  it('only fetches positions / stats when the Positions or Overview tab is active', async () => {
    // pmPositions.list is gated by tab visibility to avoid hitting the
    // network for tabs the PM isn't looking at. Asserting here by checking
    // mocked call counts.
    mockedGetProject.mockResolvedValueOnce({
      project: makeProject(),
      positions: [],
      plans: [],
      stats: { total_positions: 0, filled_positions: 0, total_plans: 0, selected_plan_id: null },
    });
    mockedStatsPositions.mockResolvedValueOnce(makeStats({ total: 0 }));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-detail-overview'));

    // The Overview tab always shows position stats, so the stats call
    // runs at least once on mount.
    expect(mockedStatsPositions).toHaveBeenCalled();
    // The Positions tab is NOT yet active, so the list call shouldn't
    // have fired yet (it's lazy on tab activation).
    expect(mockedListPositions).not.toHaveBeenCalled();

    // Switch to the Positions tab and assert the list call fires.
    fireEvent.click(within(screen.getByTestId('pm-detail-tabs')).getByRole('tab', { name: '岗位' }));
    await waitFor(() => {
      expect(mockedListPositions).toHaveBeenCalled();
    });
  });
});
