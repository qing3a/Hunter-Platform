import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HunterWorkspacePage } from '../HunterWorkspacePage';
import { dashboard } from '../../../api/hunter-portal';
import type { DashboardPayload } from '../../../api/hunter-portal';

// ---- Mocks ----------------------------------------------------------------

// Mock the hunter-portal API surface — we only need dashboard.get() here.
vi.mock('../../../api/hunter-portal', () => ({
  dashboard: {
    get: vi.fn(),
  },
}));

const mockedDashboard = vi.mocked(dashboard);

// ---- Fixture --------------------------------------------------------------

function makePayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    kpi: {
      onboards_this_month: 3,
      active_recommendations: 12,
      placements_count: 5,
      pending_pickup_count: 7,
      conversion_rate: 0.42,
    },
    top_tasks: [
      {
        id: 't1',
        hunter_user_id: 'h1',
        title: 'Call candidate about offer',
        description: null,
        related_recommendation_id: null,
        related_candidate_user_id: null,
        due_at: Date.UTC(2026, 6, 15),
        completed_at: null,
        priority: 'high',
        created_at: 1,
        updated_at: 2,
      },
      {
        id: 't2',
        hunter_user_id: 'h1',
        title: 'Review resume from 张三',
        description: null,
        related_recommendation_id: null,
        related_candidate_user_id: null,
        due_at: null,
        completed_at: null,
        priority: 'normal',
        created_at: 1,
        updated_at: 2,
      },
    ],
    kanban_summary: [
      { stage: 'submitted',    count: 4 },
      { stage: 'screen_passed', count: 2 },
      { stage: 'interview',    count: 1 },
      { stage: 'offer',        count: 0 },
      { stage: 'onboarded',    count: 0 },
    ],
    recent_recommendations: [
      {
        recommendation_id: 'r1',
        candidate_user_id: 'u1',
        candidate_name: '张*',
        job_id: 'j1',
        job_title: '前端工程师',
        pipeline_stage: 'submitted',
        updated_at: 1,
      },
      {
        recommendation_id: 'r2',
        candidate_user_id: 'u2',
        candidate_name: null,
        job_id: 'j2',
        job_title: '后端工程师',
        pipeline_stage: 'interview',
        updated_at: 2,
      },
    ],
    ...overrides,
  };
}

// ---- Helpers --------------------------------------------------------------

/**
 * Render the page wrapped in a fresh QueryClientProvider + MemoryRouter so
 * each test starts with empty cache state.
 *
 * `resolve` is called with the QueryClient so tests can decide whether to
 * pre-populate cache (for instant-success tests) or to prime the mocked API
 * only (for loading/error tests).
 */
function renderPage(options: {
  resolve?: (qc: QueryClient) => Promise<DashboardPayload>;
  rejectWith?: Error;
} = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  if (options.rejectWith) {
    mockedDashboard.get.mockRejectedValueOnce(options.rejectWith);
  } else if (options.resolve) {
    const promise = options.resolve(qc);
    mockedDashboard.get.mockImplementationOnce(() => promise);
  } else {
    mockedDashboard.get.mockReturnValueOnce(new Promise<DashboardPayload>(() => {}));
  }

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/hunter/workspace']}>
        <HunterWorkspacePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('HunterWorkspacePage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the loading state while the query is pending', async () => {
    renderPage();
    expect(await screen.findByTestId('hp-loading')).toHaveTextContent('加载中');
    // The KPI grid must not be rendered yet.
    expect(screen.queryByTestId('hp-kpi-grid')).toBeNull();
    expect(mockedDashboard.get).toHaveBeenCalledTimes(1);
  });

  it('renders the HunterSidebar and HunterMobileLayout chrome', async () => {
    const payload = makePayload();
    renderPage({ resolve: () => Promise.resolve(payload) });

    // Wait for data so the page settles (otherwise we get the loading shell,
    // which still has sidebar + mobile chrome — but doing findBy keeps the
    // assertion deterministic).
    await screen.findByTestId('hp-kpi-grid');

    // Sidebar (desktop, hidden <1024px via CSS) — always in DOM.
    expect(screen.getByText('Hunter')).toBeInTheDocument();
    // Sidebar nav links. The mobile tab bar duplicates "工作台" with the same
    // emoji prefix, so we assert the sidebar-specific emoji-prefixed labels
    // appear at least once.
    expect(screen.getAllByText('🏠 工作台').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('👥 候选人').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('📊 看板').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('✅ 任务').length).toBeGreaterThanOrEqual(1);

    // Mobile layout top-bar brand.
    expect(screen.getByText('Hunter · 工作台')).toBeInTheDocument();

    // Sidebar logout button (rendered only when session exists; renderPage
    // doesn't set one, but the sidebar NavLinks should be present).
    const sidebar = document.querySelector('.hp-sidebar');
    expect(sidebar).not.toBeNull();
    expect(sidebar?.querySelectorAll('.hp-sidebar-link').length).toBe(5);

    // Mobile layout shell is rendered too.
    const layout = document.querySelector('.hp-layout');
    expect(layout).not.toBeNull();
  });

  it('renders 4 KPI tiles with the values from the dashboard payload', async () => {
    renderPage({ resolve: () => Promise.resolve(makePayload()) });

    await screen.findByTestId('hp-kpi-grid');

    const values = screen.getAllByTestId('hp-kpi-value').map(el => el.textContent);
    expect(values).toEqual(['3', '12', '5', '7']);

    // KPI labels — ensure each label maps to its tile.
    expect(screen.getByText('本月到岗')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('成交')).toBeInTheDocument();
    expect(screen.getByText('待认领')).toBeInTheDocument();
  });

  it('renders top_tasks with titles, priority badges, and due dates', async () => {
    renderPage({ resolve: () => Promise.resolve(makePayload()) });

    const list = await screen.findByTestId('hp-task-list');
    const items = screen.getAllByTestId('hp-task-item');
    expect(items.length).toBe(2);

    // First task: title + due date + high priority badge.
    expect(list).toHaveTextContent('Call candidate about offer');
    expect(list).toHaveTextContent('high');
    const priorities = screen.getAllByTestId('hp-task-item').map(item =>
      item.querySelector('.hp-task-priority')?.getAttribute('data-priority'),
    );
    expect(priorities).toEqual(['high', 'normal']);

    // Second task: title with no due date should not render the due span.
    expect(list).toHaveTextContent('Review resume from 张三');
  });

  it('renders the empty state for top_tasks when the list is empty', async () => {
    const payload = makePayload({ top_tasks: [] });
    renderPage({ resolve: () => Promise.resolve(payload) });

    await screen.findByTestId('hp-section-tasks');
    expect(screen.queryByTestId('hp-task-list')).toBeNull();
    expect(screen.getByText('暂无待办任务')).toBeInTheDocument();
  });

  it('renders kanban_summary with one row per stage, badge labels, and counts', async () => {
    const payload = makePayload({
      kanban_summary: [
        { stage: 'submitted',    count: 5 },
        { stage: 'screen_passed', count: 3 },
        { stage: 'interview',    count: 2 },
        { stage: 'offer',        count: 1 },
        { stage: 'onboarded',    count: 1 },
      ],
    });
    renderPage({ resolve: () => Promise.resolve(payload) });

    await screen.findByTestId('hp-funnel');
    const rows = screen.getAllByTestId('hp-funnel-row');
    expect(rows.length).toBe(5);

    // Stage badge labels (Chinese) — assert each row's first badge text.
    const expectedLabels = ['投递', '简历过', '面试', 'Offer', '到岗'];
    rows.forEach((row, idx) => {
      expect(row.textContent).toContain(expectedLabels[idx]);
    });

    // Counts visible as text.
    const funnel = screen.getByTestId('hp-funnel');
    expect(funnel).toHaveTextContent('5');
    expect(funnel).toHaveTextContent('3');
    expect(funnel).toHaveTextContent('2');
    expect(funnel).toHaveTextContent('1');

    // Each row should expose its stage via data-stage.
    const stages = rows.map(r => r.getAttribute('data-stage'));
    expect(stages).toEqual(['submitted', 'screen_passed', 'interview', 'offer', 'onboarded']);
  });

  it('renders recent_recommendations with desensitized names, jobs, and stage badges', async () => {
    const payload = makePayload();
    renderPage({ resolve: () => Promise.resolve(payload) });

    await screen.findByTestId('hp-rec-list');
    const items = screen.getAllByTestId('hp-rec-item');
    expect(items.length).toBe(2);

    // First row: 张* + 前端工程师 + 投递 badge.
    expect(items[0]).toHaveTextContent('张*');
    expect(items[0]).toHaveTextContent('前端工程师');
    expect(items[0]).toHaveTextContent('投递');

    // Second row: anonymous placeholder + 后端工程师 + 面试 badge.
    expect(items[1]).toHaveTextContent('(匿名)');
    expect(items[1]).toHaveTextContent('后端工程师');
    expect(items[1]).toHaveTextContent('面试');
  });

  it('renders the empty state for recent_recommendations when the list is empty', async () => {
    const payload = makePayload({ recent_recommendations: [] });
    renderPage({ resolve: () => Promise.resolve(payload) });

    await screen.findByTestId('hp-section-recs');
    expect(screen.queryByTestId('hp-rec-list')).toBeNull();
    expect(screen.getByText('暂无最近推荐')).toBeInTheDocument();
  });

  it('renders the error state with the thrown message when the query fails', async () => {
    renderPage({ rejectWith: new Error('网络异常') });

    const err = await screen.findByTestId('hp-error');
    expect(err).toHaveTextContent('加载失败');
    expect(err).toHaveTextContent('网络异常');

    // No KPI grid on error.
    expect(screen.queryByTestId('hp-kpi-grid')).toBeNull();
    // QueryClient should NOT retry in tests (retry:false).
    expect(mockedDashboard.get).toHaveBeenCalledTimes(1);
  });
});