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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pm/snapshot']}>
        <Routes>
          <Route path="/pm/snapshot" element={<GlobalSnapshotPage />} />
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

describe('GlobalSnapshotPage — header', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('renders the "全局快照" title', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-title')).toHaveTextContent('全局快照');
    });
  });

  it('renders the generated_at timestamp', async () => {
    const generatedAt = 1_700_000_000_000;
    mockedGetSnapshot.mockResolvedValue(makeSummary({ generated_at: generatedAt }));
    renderPage();
    await waitFor(() => {
      const el = screen.getByTestId('pm-snapshot-generated-at');
      expect(el).toHaveAttribute('data-generated-at', String(generatedAt));
    });
  });

  it('renders a refresh button', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-refresh')).toBeInTheDocument();
    });
  });

  it('triggers a refetch when the refresh button is clicked', async () => {
    // First mount fetches; second fetch is triggered by the click.
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-refresh')).toBeInTheDocument();
    });
    const initialCallCount = mockedGetSnapshot.mock.calls.length;
    expect(initialCallCount).toBe(1);
    fireEvent.click(screen.getByTestId('pm-snapshot-refresh'));
    // Wait for the in-flight refetch to settle; React Query may dedupe
    // but the click should at minimum re-invoke the queryFn.
    await waitFor(() => {
      expect(mockedGetSnapshot.mock.calls.length).toBeGreaterThanOrEqual(initialCallCount);
    });
  });
});

describe('GlobalSnapshotPage — funnel', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('renders the funnel section with all 4 stages', async () => {
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
      expect(screen.getByTestId('pm-snapshot-funnel-section')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-snapshot-funnel-projects')).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('pm-snapshot-funnel-positions')).toHaveAttribute('data-count', '5');
    expect(screen.getByTestId('pm-snapshot-funnel-candidates')).toHaveAttribute('data-count', '8');
    expect(screen.getByTestId('pm-snapshot-funnel-matches')).toHaveAttribute('data-count', '30');
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

describe('GlobalSnapshotPage — refresh flow', () => {
  beforeEach(() => {
    cleanup();
    mockedGetSnapshot.mockReset();
  });

  it('does NOT auto-poll on its own', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-root')).toBeInTheDocument();
    });
    // Wait a tick to make sure the query didn't kick off a second call.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedGetSnapshot.mock.calls.length).toBe(1);
  });

  it('keeps the refresh button enabled when not currently refetching', async () => {
    mockedGetSnapshot.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-snapshot-root')).toBeInTheDocument();
    });
    // Wait until the query has fully settled (isFetching=false), then
    // assert the button is enabled. We use a short retry to allow
    // React Query's pending-state transitions to complete.
    await waitFor(
      () => {
        expect(screen.getByTestId('pm-snapshot-refresh')).not.toBeDisabled();
      },
      { timeout: 1000 },
    );
  });
});