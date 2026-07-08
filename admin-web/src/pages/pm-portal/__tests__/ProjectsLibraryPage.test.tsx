import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectsLibraryPage } from '../ProjectsLibraryPage';
import { pmProjects } from '../../../api/pm-portal';
import type { ProjectStatus, ProjectSummary } from '../../../api/pm-portal';

// ---- Mocks ----------------------------------------------------------------

// Mock the PM API client. We mock the whole namespace (not just the
// `list` method) so adding a new method to `pmProjects` doesn't break
// this file with a "method is not a function" runtime error — the
// stub namespace will simply lack the new method until tests break
// intentionally.
//
// `importOriginal` lets us pass through real exports (the label maps
// in particular) so the page under test can resolve them when its
// own module is loaded — mocking only `pmProjects`/`pmAuth` would
// leave PROJECT_STATUS_LABELS undefined.
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
    pmAuth: { requestOtp: vi.fn(), verifyOtp: vi.fn() },
  };
});

const mockedList = vi.mocked(pmProjects.list);

// ---- Helpers --------------------------------------------------------------

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    pm_user_id: 'pm-1',
    name: 'AI Engineering Expansion',
    target: 'Hire 5 senior engineers by Q4',
    budget_total: 1_200_000_00,
    start_at: null,
    end_at: null,
    current_team: null,
    status: 'active',
    position_count: 5,
    plan_count: 1,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pm/projects']}>
        <ProjectsLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function flush() {
  // react-query state updates are async; give the test a tick to settle.
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---- Tests ----------------------------------------------------------------

describe('ProjectsLibraryPage', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows a loading state while the list request is in flight', () => {
    // Return a never-resolving promise so the page stays in isLoading.
    mockedList.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('pm-library-loading')).toBeInTheDocument();
  });

  it('renders an error banner when pmProjects.list rejects', async () => {
    mockedList.mockRejectedValueOnce(new Error('网络异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-library-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-library-error')).toHaveTextContent('网络异常');
  });

  it('renders KPI cards with correct counts derived from the list response', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [
        makeProject({ id: 'p1', status: 'active' }),
        makeProject({ id: 'p2', status: 'active' }),
        makeProject({ id: 'p3', status: 'completed' }),
        makeProject({ id: 'p4', status: 'planning' }),
        makeProject({ id: 'p5', status: 'cancelled', budget_total: null }),
      ],
      // `total` is server-side and is the canonical count shown in the
      // 项目数 tile. We pass a value different from the page length to
      // prove the KPI honours the server total, not the fetched count.
      total: 47,
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-library-table')).toBeInTheDocument();
    });

    // KPI tiles — labels and values.
    const totalKpi = screen.getByTestId('pm-kpi-total');
    expect(within(totalKpi).getByText('项目数')).toBeInTheDocument();
    expect(within(totalKpi).getByTestId('pm-kpi-total-value')).toHaveTextContent('47');

    const activeKpi = screen.getByTestId('pm-kpi-active');
    expect(within(activeKpi).getByText('活跃项目')).toBeInTheDocument();
    expect(within(activeKpi).getByTestId('pm-kpi-active-value')).toHaveTextContent('2');

    const completedKpi = screen.getByTestId('pm-kpi-completed');
    expect(within(completedKpi).getByText('已完成')).toBeInTheDocument();
    expect(within(completedKpi).getByTestId('pm-kpi-completed-value')).toHaveTextContent('1');

    // Budget: 4 projects with budget = 4 * 1_200_000_00 fen = 480万.
    const budgetKpi = screen.getByTestId('pm-kpi-budget');
    expect(within(budgetKpi).getByText('总预算')).toBeInTheDocument();
    expect(within(budgetKpi).getByTestId('pm-kpi-budget-value')).toHaveTextContent('¥480.0万');
  });

  it('renders projects in the table view by default', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [makeProject({ name: 'Project Alpha' })],
      total: 1,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-library-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-library-row')).toBeInTheDocument();
    // Card view should NOT be present.
    expect(screen.queryByTestId('pm-library-cards')).toBeNull();
    expect(screen.queryByTestId('pm-project-card')).toBeNull();
  });

  it('toggles to the card view when the "卡片" button is clicked', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [makeProject({ name: 'Project Alpha' })],
      total: 1,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.click(screen.getByTestId('pm-view-card'));
    expect(screen.getByTestId('pm-library-cards')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-card')).toBeInTheDocument();
    // Table view should be gone.
    expect(screen.queryByTestId('pm-library-table')).toBeNull();
  });

  it('toggles back to the table view when the "表格" button is clicked', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [makeProject()],
      total: 1,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.click(screen.getByTestId('pm-view-card'));
    expect(screen.getByTestId('pm-library-cards')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pm-view-table'));
    expect(screen.getByTestId('pm-library-table')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-library-cards')).toBeNull();
  });

  it('persists the view-mode choice in localStorage', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [makeProject()],
      total: 1,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.click(screen.getByTestId('pm-view-card'));
    await flush();
    expect(localStorage.getItem('pm.library.viewMode')).toBe('card');

    fireEvent.click(screen.getByTestId('pm-view-table'));
    await flush();
    expect(localStorage.getItem('pm.library.viewMode')).toBe('table');
  });

  it('hydrates the view-mode from localStorage on remount', async () => {
    mockedList.mockResolvedValue({
      projects: [makeProject()],
      total: 1,
    });
    localStorage.setItem('pm.library.viewMode', 'card');

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-cards'));
    // Confirm the toggle button itself reflects the hydrated state.
    expect(screen.getByTestId('pm-view-card').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('pm-view-table').getAttribute('data-active')).toBe('false');
  });

  it('filters projects by status (client-side)', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [
        makeProject({ id: 'a', name: 'Active Project', status: 'active' }),
        makeProject({ id: 'b', name: 'Completed Project', status: 'completed' }),
        makeProject({ id: 'c', name: 'Paused Project', status: 'paused' }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    expect(screen.getAllByTestId('pm-library-row')).toHaveLength(3);

    fireEvent.change(screen.getByTestId('pm-library-status'), {
      target: { value: 'active' },
    });
    await flush();
    const rows = screen.getAllByTestId('pm-library-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Active Project');
  });

  it('searches by project name (case-insensitive, contains)', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [
        makeProject({ id: 'a', name: 'Frontend Lead' }),
        makeProject({ id: 'b', name: 'Backend Architect' }),
        makeProject({ id: 'c', name: 'mobile engineer' }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: 'mobile' },
    });
    await flush();
    const rows = screen.getAllByTestId('pm-library-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('mobile engineer');
  });

  it('combines search and status filters (intersection)', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [
        makeProject({ id: 'a', name: 'AI Active', status: 'active' }),
        makeProject({ id: 'b', name: 'AI Completed', status: 'completed' }),
        makeProject({ id: 'c', name: 'Mobile Active', status: 'active' }),
      ],
      total: 3,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.change(screen.getByTestId('pm-library-search'), { target: { value: 'ai' } });
    fireEvent.change(screen.getByTestId('pm-library-status'), { target: { value: 'active' } });
    await flush();
    const rows = screen.getAllByTestId('pm-library-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('AI Active');
  });

  it('renders the empty state when no projects exist', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => {
      // The empty state message lives outside the loading region; assert
      // by content to avoid coupling to the candidate-portal EmptyState
      // implementation.
      expect(screen.getByText('暂无项目')).toBeInTheDocument();
    });
    expect(screen.getByText('点击「新建项目」开始你的第一个招聘项目')).toBeInTheDocument();
  });

  it('renders the "no match" empty state when search/filter hides all rows', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [makeProject({ name: 'Alpha' })],
      total: 1,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: 'zzz-no-match' },
    });
    await flush();
    expect(screen.getByText('没有匹配的项目')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-library-table')).toBeNull();
  });

  it('renders the "+ 新建项目" button in the header', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-new-project'));
    expect(screen.getByTestId('pm-new-project')).toHaveTextContent('+ 新建项目');
  });

  it('opens the placeholder New Project modal when the button is clicked', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-new-project'));

    fireEvent.click(screen.getByTestId('pm-new-project'));
    expect(screen.getByTestId('pm-new-project-modal')).toBeInTheDocument();
    // The placeholder text is hard-coded in the modal body.
    expect(screen.getByText(/ProjectMetaModal — coming in Task 15/)).toBeInTheDocument();
  });

  it('closes the New Project modal when the close button is clicked', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-new-project'));

    fireEvent.click(screen.getByTestId('pm-new-project'));
    expect(screen.getByTestId('pm-new-project-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pm-new-project-modal-close'));
    expect(screen.queryByTestId('pm-new-project-modal')).toBeNull();
  });

  it('closes the modal when the backdrop is clicked', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-new-project'));

    fireEvent.click(screen.getByTestId('pm-new-project'));
    const backdrop = screen.getByTestId('pm-new-project-modal');
    // The backdrop is the testid-bearing element; clicking it should
    // dismiss the modal. The inner .pm-modal stops propagation.
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('pm-new-project-modal')).toBeNull();
  });

  it('renders the row status badge with the correct data-status', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [
        makeProject({ id: 'a', status: 'active' }),
        makeProject({ id: 'b', status: 'paused' }),
      ],
      total: 2,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    const rows = screen.getAllByTestId('pm-library-row');
    expect(within(rows[0]).getByText('进行中').getAttribute('data-status')).toBe('active');
    expect(within(rows[1]).getByText('已暂停').getAttribute('data-status')).toBe('paused');
  });

  it('passes { limit: 100 } to pmProjects.list (max page size)', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-new-project'));
    expect(mockedList).toHaveBeenCalledWith({ limit: 100 });
  });

  it('survives a project with a null budget (renders "—" in the table cell)', async () => {
    mockedList.mockResolvedValueOnce({
      projects: [makeProject({ name: 'Unbudgeted', budget_total: null })],
      total: 1,
    });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    const row = screen.getByTestId('pm-library-row');
    expect(within(row).getByText('-')).toBeInTheDocument();
  });

  it('every ProjectStatus option is present in the status filter', async () => {
    mockedList.mockResolvedValueOnce({ projects: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-status'));

    const select = screen.getByTestId('pm-library-status') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);

    // "all" + 5 statuses.
    const expected: ('all' | ProjectStatus)[] = [
      'all', 'planning', 'active', 'paused', 'completed', 'cancelled',
    ];
    for (const v of expected) {
      expect(optionValues).toContain(v);
    }
  });
});
