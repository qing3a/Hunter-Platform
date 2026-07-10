import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelineSandboxPage } from '../PipelineSandboxPage';
import {
  pmPositions,
  pmSandbox,
  type Position,
  type SandboxSummary,
  type SandboxStageBucket,
  type SandboxStage,
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
    pmPositions: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulkCreate: vi.fn(),
      stats: vi.fn(),
    },
    pmSandbox: {
      get: vi.fn(),
    },
  };
});

const mockedGetPosition = vi.mocked(pmPositions.get);
const mockedListPositions = vi.mocked(pmPositions.list);
const mockedGetSandbox = vi.mocked(pmSandbox.get);

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

function makeBucket(stage: SandboxStage, overrides: Partial<SandboxStageBucket> = {}): SandboxStageBucket {
  return {
    stage,
    count: 0,
    risk_count: { stuck_long: 0, stuck_very_long: 0 },
    candidates: [],
    ...overrides,
  };
}

function makeSummary(overrides: Partial<SandboxSummary> = {}): SandboxSummary {
  const stages: SandboxStageBucket[] = (
    ['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'] as SandboxStage[]
  ).map((s) => makeBucket(s));
  return {
    position: {
      id: 'pos-1',
      title: 'Senior Frontend Engineer',
      total_headcount_planned: 5,
      total_headcount_filled: 1,
    },
    stages,
    total: 0,
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
        <MemoryRouter initialEntries={[`/admin/pm/positions/${positionId}/sandbox`]}>
          <Routes>
            <Route path="/admin/pm/positions/:id/sandbox" element={<PipelineSandboxPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('PipelineSandboxPage — loading / error', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListPositions.mockReset();
    mockedGetSandbox.mockReset();
    // Task 7 — PipelineSandboxPage hosts an inline <PositionPicker>
    // that fetches the project's positions. Default to an empty list
    // so existing tests don't trip on the new query (the page still
    // seeds the picker with the current position as a fallback).
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('shows a loading state while both queries are in flight', () => {
    mockedGetPosition.mockReturnValue(new Promise(() => {}));
    mockedGetSandbox.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('pm-sandbox-loading')).toBeInTheDocument();
  });

  it('renders a position-error banner when pmPositions.get rejects', async () => {
    mockedGetPosition.mockRejectedValueOnce(new Error('岗位不可用'));
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-position-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-sandbox-position-error')).toHaveTextContent('岗位不可用');
  });

  it('renders a sandbox-error banner when pmSandbox.get rejects', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockRejectedValueOnce(new Error('漏斗服务异常'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-sandbox-error')).toHaveTextContent('漏斗服务异常');
  });
});

describe('PipelineSandboxPage — header + meta', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListPositions.mockReset();
    mockedGetSandbox.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders the position title in the header', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ title: 'Staff Backend Engineer' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-title')).toHaveTextContent('Staff Backend Engineer · 招聘漏斗');
    });
  });

  it('renders headcount planned/filled + total funnel count', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ headcount_planned: 10, headcount_filled: 3 }),
      stats: { headcount_planned: 10, headcount_filled: 3, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(
      makeSummary({
        total: 7,
        stages: (['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'] as SandboxStage[])
          .map((s, i) => makeBucket(s, { count: i === 0 ? 7 : 0 })),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-total')).toHaveTextContent('7');
    });
    expect(screen.getByTestId('pm-sandbox-meta')).toHaveTextContent('3/10');
    expect(screen.getByTestId('pm-sandbox-meta')).toHaveTextContent('7');
  });

  it('navigates back to the project detail when clicking 返回项目详情', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ project_id: 'proj-99' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    // Wait for the funnel cards to render (proof both queries resolved).
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-funnel')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-sandbox-back'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects/proj-99');
  });
});

describe('PipelineSandboxPage — funnel cards', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListPositions.mockReset();
    mockedGetSandbox.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders all 6 funnel cards in canonical pipeline order', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-funnel')).toBeInTheDocument();
    });
    const order = ['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'];
    const cards = screen.getAllByTestId(/^pm-sandbox-funnel-(submitted|screen_passed|interview|offer|onboarded|rejected)$/);
    expect(cards.map((c) => c.getAttribute('data-stage'))).toEqual(order);
  });

  it('shows the per-stage count on each card', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(
      makeSummary({
        stages: (['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'] as SandboxStage[])
          .map((s, i) => makeBucket(s, { count: i + 1 })),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-funnel-submitted')).toHaveAttribute('data-count', '1');
    });
    expect(screen.getByTestId('pm-sandbox-funnel-screen_passed')).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('pm-sandbox-funnel-interview')).toHaveAttribute('data-count', '3');
    expect(screen.getByTestId('pm-sandbox-funnel-offer')).toHaveAttribute('data-count', '4');
    expect(screen.getByTestId('pm-sandbox-funnel-onboarded')).toHaveAttribute('data-count', '5');
    expect(screen.getByTestId('pm-sandbox-funnel-rejected')).toHaveAttribute('data-count', '6');
  });

  it('shows a risk indicator on cards where risk_count > 0', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(
      makeSummary({
        stages: (['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'] as SandboxStage[])
          .map((s, i) =>
            makeBucket(s, {
              count: 1,
              risk_count: i === 2 ? { stuck_long: 1, stuck_very_long: 0 } : { stuck_long: 0, stuck_very_long: 0 },
            }),
          ),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-funnel-risk-interview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-sandbox-funnel-risk-interview')).toHaveTextContent('1 风险');
    expect(screen.getByTestId('pm-sandbox-funnel-interview')).toHaveClass('has-risk');
    // Other stages should NOT have a risk indicator
    expect(screen.queryByTestId('pm-sandbox-funnel-risk-submitted')).toBeNull();
    expect(screen.queryByTestId('pm-sandbox-funnel-risk-offer')).toBeNull();
  });
});

describe('PipelineSandboxPage — Task 8 inline candidate list + on-track alert + export', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListPositions.mockReset();
    mockedGetSandbox.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders the <ul className="pm-funnel-candidates"> inline by default (no click needed)', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(
      makeSummary({
        stages: (['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'] as SandboxStage[])
          .map((s, i) => makeBucket(s, {
            count: i === 1 ? 2 : 0,
            candidates: i === 1 ? [
              { recommendation_id: 'rec_a', candidate_user_id: 'u_a', candidate_display_name: 'A***ce', stage_entered_at: Date.now() - 5 * 86_400_000, risk_flags: [] },
              { recommendation_id: 'rec_b', candidate_user_id: 'u_b', candidate_display_name: 'B***ob', stage_entered_at: Date.now() - 35 * 86_400_000, risk_flags: ['stuck_long'] },
            ] : [],
          })),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-funnel-screen_passed')).toBeInTheDocument();
    });
    // The candidate list is rendered WITHOUT any click.
    const list = screen.getByTestId('pm-sandbox-funnel-candidates-screen_passed');
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe('UL');
    expect(list).toHaveClass('pm-funnel-candidates');
    // And it contains the rows we seeded.
    expect(screen.getByTestId('pm-sandbox-funnel-candidate-screen_passed-rec_a')).toBeInTheDocument();
    expect(screen.getByTestId('pm-sandbox-funnel-candidate-screen_passed-rec_b')).toBeInTheDocument();
    expect(screen.getByTestId('pm-sandbox-funnel-candidate-flag-rec_b-stuck_long')).toHaveTextContent(
      '停留 > 30 天',
    );
  });

  it('renders the empty placeholder for stages with 0 candidates', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-funnel-rejected')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('pm-sandbox-funnel-candidates-empty-rejected'),
    ).toHaveTextContent('—');
  });

  it('renders the 📋 导出报告 button in the top action bar', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-export-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-sandbox-export-btn')).toHaveTextContent('导出报告');
  });

  it('fires a toast when the export button is clicked', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition(),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-sandbox-export-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('pm-sandbox-export-btn'));
    await waitFor(() => {
      // ToastProvider renders individual .toast items with the message text.
      expect(screen.getAllByText(/导出报告/).length).toBeGreaterThan(0);
    });
  });

  it('renders <OnTrackAlert ok=true when offer+onboarded >= headcount_planned', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ headcount_planned: 5, headcount_filled: 5 }),
      stats: { headcount_planned: 5, headcount_filled: 5, is_complete: true },
    });
    // offer=3 + onboarded=3 = 6 >= 5 → on-track
    mockedGetSandbox.mockResolvedValue(
      makeSummary({
        stages: (['submitted', 'screen_passed', 'interview', 'offer', 'onboarded', 'rejected'] as SandboxStage[])
          .map((s, i) => makeBucket(s, {
            count: i === 3 ? 3 : i === 4 ? 3 : 0,
          })),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-ontrack-ok')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-ontrack-ok')).toHaveTextContent('✓ 节奏正常');
  });

  it('renders <OnTrackAlert warn when offer+onboarded < headcount_planned', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ headcount_planned: 5, headcount_filled: 1 }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    // offer=0 + onboarded=0 = 0 < 5 → amber remediation
    mockedGetSandbox.mockResolvedValue(makeSummary());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-ontrack-warn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-ontrack-warn')).toHaveTextContent('还差 5 个');
    expect(screen.getByTestId('pm-ontrack-warn')).toHaveTextContent('已 0');
    expect(screen.getByTestId('pm-ontrack-warn')).toHaveTextContent('目标 5');
  });
});

// -------------------------------------------------------------------------
// Task 7 — inline PositionPicker in the sandbox header
// -------------------------------------------------------------------------

describe('PipelineSandboxPage — Task 7 PositionPicker', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetPosition.mockReset();
    mockedListPositions.mockReset();
    mockedGetSandbox.mockReset();
    mockedListPositions.mockResolvedValue({ positions: [], total: 0 });
  });

  it('renders the <PositionPicker> with the project positions', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ project_id: 'proj-1' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
    mockedListPositions.mockResolvedValueOnce({
      positions: [
        makePosition({ id: 'pos-1', title: 'Senior Frontend Engineer', title_level: 'senior' }),
        makePosition({ id: 'pos-2', title: 'Tech Lead', title_level: 'staff' }),
      ],
      total: 2,
    });

    renderPage();
    // Wait for the list query to resolve and the picker to re-render
    // with the second option (the picker first renders with a single
    // fallback option while the list query is in flight).
    await waitFor(() => {
      const picker = screen.getByTestId('pm-position-picker');
      expect(picker.querySelectorAll('option')).toHaveLength(2);
    });

    const picker = screen.getByTestId('pm-position-picker');
    const options = picker.querySelectorAll('option');
    expect(options[0]).toHaveTextContent('Senior Frontend Engineer');
    expect(options[1]).toHaveTextContent('Tech Lead');
  });

  it('navigates to the new position sandbox when the <PositionPicker> selection changes', async () => {
    mockedGetPosition.mockResolvedValue({
      position: makePosition({ project_id: 'proj-1' }),
      stats: { headcount_planned: 5, headcount_filled: 1, is_complete: false },
    });
    mockedGetSandbox.mockResolvedValue(makeSummary());
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
      '/admin/pm/projects/proj-1/positions/pos-2/sandbox',
    );
  });
});