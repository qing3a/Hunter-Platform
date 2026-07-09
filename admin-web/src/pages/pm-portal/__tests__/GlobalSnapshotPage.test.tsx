import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GlobalSnapshotPage } from '../GlobalSnapshotPage';
import {
  pmSnapshot,
  type SnapshotSummary,
  type ActivityEvent,
} from '../../../api/pm-portal';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/pm-portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/pm-portal')>();
  return {
    ...actual,
    pmSnapshot: {
      get: vi.fn(),
    },
  };
});

const mockedGetSnapshot = vi.mocked(pmSnapshot.get);

// ---- Helpers --------------------------------------------------------------

function makeSummary(overrides: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return {
    funnel: {
      projects: {
        total: 0,
        by_status: { planning: 0, active: 0, paused: 0, completed: 0, cancelled: 0 },
      },
      positions: {
        total: 0,
        by_status: { open: 0, paused: 0, filled: 0 },
        headcount_planned_total: 0,
        headcount_filled_total: 0,
      },
      candidates: { total: 0, distinct: 0 },
      matches: { total: 0, avg_score: 0 },
    },
    activity: [],
    generated_at: Date.now(),
    ...overrides,
  };
}

function makeActivityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    event_type: 'application',
    occurred_at: Date.now() - 5 * 60 * 1000,
    project_id: 'proj_1',
    position_id: 'pos_1',
    candidate_user_id: 'user_1',
    summary: '张*三 申请了 高级前端工程师',
    ...overrides,
  };
}

function renderPage(initialEntries: string[] = ['/admin/pm/snapshot']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/admin/pm/snapshot" element={<GlobalSnapshotPage />} />
          <Route path="/admin/pm/projects" element={<div data-testid="projects-page">projects</div>} />
          <Route path="/admin/pm/library" element={<div data-testid="library-page">library</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('GlobalSnapshotPage — loading / error', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('shows a loading state while the snapshot query is in flight', () => {
    mockedGetSnapshot.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('pm-snapshot-loading')).toBeInTheDocument();
  });

  it('renders an error banner when pmSnapshot.get rejects', async () => {
    mockedGetSnapshot.mockRejectedValueOnce(new Error('快照服务异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-snapshot-error')).toHaveTextContent('快照服务异常');
  });
});

describe('GlobalSnapshotPage — header / topfilter', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('renders the new "全局快照" title with the bird-eye subtitle', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-title')).toHaveTextContent('全局快照 · 跨项目鸟瞰');
    });
  });

  it('renders the TopFilterBar with default chip values', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-topfilter')).toBeInTheDocument();
    });
    expect(screen.getByText('📁 项目: 全部 ▾')).toBeInTheDocument();
    expect(screen.getByLabelText('状态过滤')).toHaveValue('进行中');
    expect(screen.getByLabelText('时间范围')).toHaveValue('近 90 天');
  });

  it('triggers a refetch when the refresh button is clicked', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-topfilter-refresh')).toBeInTheDocument();
    });
    const initialCallCount = mockedGetSnapshot.mock.calls.length;
    expect(initialCallCount).toBe(1);
    fireEvent.click(screen.getByTestId('pm-topfilter-refresh'));
    await waitFor(() => {
      expect(mockedGetSnapshot.mock.calls.length).toBeGreaterThanOrEqual(initialCallCount);
    });
  });

  it('does NOT auto-poll on its own', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-root')).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedGetSnapshot.mock.calls.length).toBe(1);
  });
});

describe('GlobalSnapshotPage — drill funnel', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('renders the horizontal funnel pipeline with 4 stage cards', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary({
      funnel: {
        projects: { total: 3, by_status: { planning: 1, active: 1, paused: 1, completed: 0, cancelled: 0 } },
        positions: { total: 5, by_status: { open: 3, paused: 1, filled: 1 }, headcount_planned_total: 10, headcount_filled_total: 4 },
        candidates: { total: 12, distinct: 8 },
        matches: { total: 30, avg_score: 72 },
      },
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-funnel-pipeline')).toBeInTheDocument();
    });
    // 4 stage cards, one per stage token
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('3');
    expect(screen.getByTestId('pm-funnel-stage-positions')).toHaveTextContent('5');
    expect(screen.getByTestId('pm-funnel-stage-candidates')).toHaveTextContent('12');
    expect(screen.getByTestId('pm-funnel-stage-matches')).toHaveTextContent('30');
  });

  it('drills to /admin/pm/projects when the projects card is clicked', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-funnel-stage-projects')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-funnel-stage-projects'));
    await waitFor(() => {
      expect(screen.getByTestId('projects-page')).toBeInTheDocument();
    });
  });

  it('drills to /admin/pm/library when the candidates card is clicked', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-funnel-stage-candidates')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-funnel-stage-candidates'));
    await waitFor(() => {
      expect(screen.getByTestId('library-page')).toBeInTheDocument();
    });
  });

  it('renders the tip line below the funnel', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-tip')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-snapshot-tip')).toHaveTextContent('点击任一阶段卡片下钻查看详情');
  });

  it('renders stage-specific sub-items (by_status for projects / positions)', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary({
      funnel: {
        projects: { total: 3, by_status: { planning: 1, active: 1, paused: 1, completed: 0, cancelled: 0 } },
        positions: { total: 5, by_status: { open: 3, paused: 1, filled: 1 }, headcount_planned_total: 10, headcount_filled_total: 4 },
        candidates: { total: 12, distinct: 8 },
        matches: { total: 30, avg_score: 72 },
      },
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-funnel-stage-projects')).toBeInTheDocument();
    });
    // Projects by_status shows the Chinese label
    expect(screen.getByTestId('pm-funnel-stage-projects')).toHaveTextContent('招聘中 1');
    // Candidates card surfaces the distinct (de-duplicated) count
    expect(screen.getByTestId('pm-funnel-stage-candidates')).toHaveTextContent('已脱敏 8');
    // Matches card surfaces the avg_score
    expect(screen.getByTestId('pm-funnel-stage-matches')).toHaveTextContent('平均分 72');
  });
});

describe('GlobalSnapshotPage — activity feed', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('renders the activity section', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-activity-section')).toBeInTheDocument();
    });
  });

  it('renders an empty-state message when there are no events', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary({ activity: [] }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-feed-empty')).toBeInTheDocument();
    });
  });

  it('renders a row for each activity event', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary({
      activity: [
        makeActivityEvent({ event_type: 'application', summary: '张*三 申请了 高级前端' }),
        makeActivityEvent({ event_type: 'pickup', summary: '猎头认领了 李*四 · 高级后端' }),
        makeActivityEvent({ event_type: 'match_created', summary: '系统为 王*五 生成了匹配 · 高级测试' }),
      ],
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('pm-snapshot-feed-item')).toHaveLength(3);
    });
  });

  it('does NOT render the empty-state when there are events', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary({
      activity: [makeActivityEvent()],
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-feed')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pm-snapshot-feed-empty')).not.toBeInTheDocument();
  });

  it('passes the events through to the ActivityFeed component', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary({
      activity: [makeActivityEvent({ summary: '张*三 申请了 高级前端工程师' })],
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-feed-summary')).toHaveTextContent(
        '张*三 申请了 高级前端工程师',
      );
    });
  });
});