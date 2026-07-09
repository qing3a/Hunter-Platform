import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmployerDashboardPage } from '../EmployerDashboardPage';
import { employerDashboard, type DashboardData } from '../../../api/employer';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/employer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/employer')>();
  return {
    ...actual,
    employerDashboard: {
      get: vi.fn(),
    },
  };
});

const mockedGet = vi.mocked(employerDashboard.get);

// ---- Helpers --------------------------------------------------------------

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    active_jobs: 0,
    open_positions: 0,
    candidates_viewed_this_month: 0,
    interested_count: 0,
    unlocked_count: 0,
    placements_count: 0,
    spend_this_month: 0,
    ...overrides,
  };
}

function renderPage(initialEntries: string[] = ['/admin/employer/dashboard']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/admin/employer/dashboard"
            element={<EmployerDashboardPage />}
          />
          <Route
            path="/admin/employer/jobs"
            element={<div data-testid="jobs-page">jobs</div>}
          />
          <Route
            path="/admin/employer/candidates"
            element={<div data-testid="candidates-page">candidates</div>}
          />
          <Route
            path="/admin/employer/placements"
            element={<div data-testid="placements-page">placements</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('EmployerDashboardPage — loading / error', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
  });

  it('shows a loading state while the dashboard query is in flight', () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('employer-dashboard-loading')).toBeInTheDocument();
  });

  it('renders an error banner when employerDashboard.get rejects', async () => {
    mockedGet.mockRejectedValueOnce(new Error('仪表盘服务异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-dashboard-error')).toHaveTextContent('仪表盘服务异常');
  });
});

describe('EmployerDashboardPage — KPI tiles', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
  });

  it('renders the 7 KPI labels on the dashboard', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });

    // 7 KPI tile labels (see plan §Task 4)
    expect(screen.getByTestId('employer-kpi-active-jobs')).toHaveTextContent('活跃工作');
    expect(screen.getByTestId('employer-kpi-open-positions')).toHaveTextContent('开放岗位');
    expect(screen.getByTestId('employer-kpi-candidates-viewed')).toHaveTextContent('本月浏览');
    expect(screen.getByTestId('employer-kpi-interested')).toHaveTextContent('表达兴趣数');
    expect(screen.getByTestId('employer-kpi-unlocked')).toHaveTextContent('解锁数');
    expect(screen.getByTestId('employer-kpi-placements')).toHaveTextContent('成交数');
    expect(screen.getByTestId('employer-kpi-spend')).toHaveTextContent('本月花费');
  });

  it('renders the 7 numeric KPI values from the dashboard payload', async () => {
    mockedGet.mockResolvedValue(
      makeData({
        active_jobs: 5,
        open_positions: 5,
        candidates_viewed_this_month: 42,
        interested_count: 9,
        unlocked_count: 3,
        placements_count: 2,
        spend_this_month: 120000,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });

    expect(screen.getByTestId('employer-kpi-active-jobs-value')).toHaveTextContent('5');
    expect(screen.getByTestId('employer-kpi-open-positions-value')).toHaveTextContent('5');
    expect(screen.getByTestId('employer-kpi-candidates-viewed-value')).toHaveTextContent('42');
    expect(screen.getByTestId('employer-kpi-interested-value')).toHaveTextContent('9');
    expect(screen.getByTestId('employer-kpi-unlocked-value')).toHaveTextContent('3');
    expect(screen.getByTestId('employer-kpi-placements-value')).toHaveTextContent('2');
    // spend is a plain integer (CNY cents — see audit); the UI formats as ¥.
    expect(screen.getByTestId('employer-kpi-spend-value')).toHaveTextContent('¥1,200');
  });

  it('formats the spend value with a thousands separator', async () => {
    mockedGet.mockResolvedValue(makeData({ spend_this_month: 1234567 }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-kpi-spend-value')).toHaveTextContent('¥12,346');
    });
  });

  it('renders the dashboard header / title', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-title')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-dashboard-title')).toHaveTextContent('雇主工作台');
  });
});

describe('EmployerDashboardPage — interactions', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
  });

  it('triggers a refetch when the refresh button is clicked', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-refresh')).toBeInTheDocument();
    });
    const initialCallCount = mockedGet.mock.calls.length;
    expect(initialCallCount).toBe(1);
    fireEvent.click(screen.getByTestId('employer-dashboard-refresh'));
    await waitFor(() => {
      expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(initialCallCount + 1);
    });
  });

  it('does NOT auto-poll on its own', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedGet.mock.calls.length).toBe(1);
  });

  it('renders zero values cleanly when the dashboard is empty', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });

    // Each KPI tile should render its numeric value (0) — not blank.
    expect(screen.getByTestId('employer-kpi-active-jobs-value')).toHaveTextContent('0');
    expect(screen.getByTestId('employer-kpi-spend-value')).toHaveTextContent('¥0');
  });
});

describe('EmployerDashboardPage — quick-action navigation', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
  });

  it('navigates to /admin/employer/jobs when the jobs button is clicked', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-dashboard-goto-jobs'));
    await waitFor(() => {
      expect(screen.getByTestId('jobs-page')).toBeInTheDocument();
    });
  });

  it('navigates to /admin/employer/candidates when the candidates button is clicked', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-dashboard-goto-candidates'));
    await waitFor(() => {
      expect(screen.getByTestId('candidates-page')).toBeInTheDocument();
    });
  });

  it('navigates to /admin/employer/placements when the placements button is clicked', async () => {
    mockedGet.mockResolvedValue(makeData());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-dashboard-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-dashboard-goto-placements'));
    await waitFor(() => {
      expect(screen.getByTestId('placements-page')).toBeInTheDocument();
    });
  });
});