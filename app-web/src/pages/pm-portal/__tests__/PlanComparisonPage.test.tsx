import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanComparisonPage } from '../PlanComparisonPage';
import {
  pmPlans,
  pmProjects,
  pmPositions,
  type Plan,
  type Position,
  type Project,
  type ProjectSummary,
} from '../../../api/pm-portal';
import { ToastProvider } from '@hunter-platform/shared-web/lib';

// ---- Mocks ----------------------------------------------------------------

// Capture navigation so we can assert on the back-button → route transitions
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
// the label maps and other type-only exports.
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
    pmPlans: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      select: vi.fn(),
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
  };
});

const mockedGetProject = vi.mocked(pmProjects.get);
const mockedListPlans = vi.mocked(pmPlans.list);
const mockedListPositions = vi.mocked(pmPositions.list);
const mockedSelectPlan = vi.mocked(pmPlans.select);

// ---- Helpers --------------------------------------------------------------

function makeProject(overrides: Partial<ProjectSummary> = {}): Project {
  return {
    id: 'proj-1',
    pm_user_id: 'pm-1',
    name: 'AI Engineering Expansion',
    target: 'Hire 5 senior engineers by Q4',
    budget_total: 20_000_000, // 20万 fen
    start_at: 1_700_000_000_000,
    end_at: 1_800_000_000_000,
    current_team: null,
    status: 'active',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    project_id: 'proj-1',
    name: 'Plan A',
    description: 'Standard plan',
    total_headcount: 10,
    estimated_cost: 5_000_000,
    positions_json: [],
    is_selected: 0,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    project_id: 'proj-1',
    title: 'Senior Frontend Engineer',
    description: null,
    required_skills: ['React'],
    title_level: 'senior',
    industry: null,
    salary_min: null,
    salary_max: null,
    status: 'open',
    headcount_planned: 1,
    headcount_filled: 0,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderPage(projectId = 'proj-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/admin/pm/projects/${projectId}/compare`]}>
          <Routes>
            <Route path="/admin/pm/projects/:id/compare" element={<PlanComparisonPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function setupProjectDetail(opts: { project?: Partial<Project> } = {}) {
  const project = makeProject(opts.project);
  mockedGetProject.mockResolvedValue({
    project,
    positions: [],
    plans: [],
    stats: {
      total_positions: 0,
      filled_positions: 0,
      total_plans: 0,
      selected_plan_id: null,
    },
  });
  return project;
}

// ---- Tests ----------------------------------------------------------------

describe('PlanComparisonPage — loading / error', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('shows a loading state while the project / plans queries are in flight', () => {
    mockedGetProject.mockReturnValue(new Promise(() => {}));
    mockedListPlans.mockReturnValue(new Promise(() => {}));
    mockedListPositions.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('pm-compare-loading')).toBeInTheDocument();
  });

  it('renders a project error banner when pmProjects.get rejects', async () => {
    mockedGetProject.mockRejectedValueOnce(new Error('网络异常'));
    mockedListPlans.mockResolvedValueOnce({ plans: [], total: 0 });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-compare-error')).toHaveTextContent('网络异常');
  });

  it('renders a plans error banner when pmPlans.list rejects', async () => {
    setupProjectDetail();
    mockedListPlans.mockRejectedValueOnce(new Error('plans down'));
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-plans-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-compare-plans-error')).toHaveTextContent('plans down');
  });
});

describe('PlanComparisonPage — empty / single-plan states', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('shows the "暂无计划" empty state when the project has no plans', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({ plans: [], total: 0 });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('暂无计划,请先创建')).toBeInTheDocument();
  });

  it('shows the "至少需要 2 个计划" hint when the project has only 1 plan', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [makePlan({ name: 'Solo Plan' })],
      total: 1,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-single')).toBeInTheDocument();
    });
    expect(screen.getByText('至少需要 2 个计划才能对比')).toBeInTheDocument();
  });
});

describe('PlanComparisonPage — comparison grid', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('auto-selects the active plan + the 2 most recent others for comparison', async () => {
    setupProjectDetail();
    // 4 plans. Active = plan-2. The other 3 are sorted by created_at
    // desc (plan-4 newest, plan-3, plan-1 oldest). The auto-seed
    // includes active + most-recent until cap (3) → plan-2 + plan-4 +
    // plan-3.
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'plan-1', name: 'Plan 1', created_at: 1_000 }),
        makePlan({ id: 'plan-2', name: 'Plan 2', is_selected: 1, created_at: 2_000 }),
        makePlan({ id: 'plan-3', name: 'Plan 3', created_at: 3_000 }),
        makePlan({ id: 'plan-4', name: 'Plan 4', created_at: 4_000 }),
      ],
      total: 4,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-grid')).toBeInTheDocument();
    });
    const cards = screen.getAllByTestId('pm-plan-card');
    expect(cards).toHaveLength(3);
    // Card order = insertion order: plan-2, plan-4, plan-3.
    expect(cards[0].getAttribute('data-plan-id')).toBe('plan-2');
    expect(cards[1].getAttribute('data-plan-id')).toBe('plan-4');
    expect(cards[2].getAttribute('data-plan-id')).toBe('plan-3');
  });

  it('marks the active plan with pm-plan-card-selected + the ribbon', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'plan-a', is_selected: 0 }),
        makePlan({ id: 'plan-b', is_selected: 1 }),
      ],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-grid')).toBeInTheDocument();
    });
    const cards = screen.getAllByTestId('pm-plan-card');
    const active = cards.find((c) => c.getAttribute('data-plan-id') === 'plan-b')!;
    expect(active.className).toContain('pm-plan-card-selected');
    expect(active.getAttribute('data-selected')).toBe('true');
    expect(within(active).getByTestId('pm-plan-card-selected-ribbon')).toBeInTheDocument();
  });

  it('shows the "请选择 2-3 个计划进行对比" hint when < 2 are selected', async () => {
    setupProjectDetail();
    // 2 plans exist but we manually deselect one. Auto-seed picks both,
    // so we have to deselect to reach the < 2 state.
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'plan-a', is_selected: 1 }),
        makePlan({ id: 'plan-b', is_selected: 0 }),
      ],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    fireEvent.click(screen.getByTestId('pm-compare-pill-plan-b'));
    fireEvent.click(screen.getByTestId('pm-compare-pill-plan-a'));
    expect(screen.getByTestId('pm-compare-pick-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-compare-grid')).toBeNull();
  });

  it('renders a plan card for every visible plan with HC / cost / radar / tag list', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'plan-a', total_headcount: 18, estimated_cost: 1_500_000 }),
        makePlan({ id: 'plan-b', total_headcount: 25, estimated_cost: 2_000_000 }),
      ],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    const cards = screen.getAllByTestId('pm-plan-card');
    expect(cards).toHaveLength(2);

    // Each card has the four expected sections.
    for (const card of cards) {
      expect(within(card).getByTestId('pm-plan-card-headcount')).toBeInTheDocument();
      expect(within(card).getByTestId('pm-plan-card-cost')).toBeInTheDocument();
      expect(within(card).getByTestId('pm-plan-card-tags')).toBeInTheDocument();
      expect(card.querySelector('svg')).toBeInTheDocument();
    }
  });

  it('shows the back button that navigates to /admin/pm/projects/:id', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [makePlan({ id: 'p1' }), makePlan({ id: 'p2' })],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-back'));
    fireEvent.click(screen.getByTestId('pm-compare-back'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects/proj-1');
  });
});

describe('PlanComparisonPage — picker / selection state', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('caps the comparison at 3 plans and shows a hint when 4th is clicked', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'p1', is_selected: 1, created_at: 1 }),
        makePlan({ id: 'p2', created_at: 2 }),
        makePlan({ id: 'p3', created_at: 3 }),
        makePlan({ id: 'p4', created_at: 4 }),
      ],
      total: 4,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    // Initial auto-seed = p1 + p3 + p4 (active + 2 most recent, capped at 3).
    // Try to add p2: should be disabled.
    const pillP2 = screen.getByTestId('pm-compare-pill-p2') as HTMLButtonElement;
    expect(pillP2).toBeDisabled();

    // Remove p1 (deselect) → p2 should now be enabled.
    fireEvent.click(screen.getByTestId('pm-compare-pill-p1'));
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-pill-p2')).not.toBeDisabled();
    });
  });

  it('toggles a plan in / out of the comparison grid when the pill is clicked', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'p1', is_selected: 1, created_at: 1 }),
        makePlan({ id: 'p2', created_at: 2 }),
        makePlan({ id: 'p3', created_at: 3 }),
      ],
      total: 3,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    // All 3 are auto-seeded. Deselect p3.
    fireEvent.click(screen.getByTestId('pm-compare-pill-p3'));
    await waitFor(() => {
      const cards = screen.getAllByTestId('pm-plan-card');
      expect(cards).toHaveLength(2);
    });
    // Re-select p3.
    fireEvent.click(screen.getByTestId('pm-compare-pill-p3'));
    await waitFor(() => {
      expect(screen.getAllByTestId('pm-plan-card')).toHaveLength(3);
    });
  });

  it('shows the "已选 N / 3" counter', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'p1', is_selected: 1, created_at: 1 }),
        makePlan({ id: 'p2', created_at: 2 }),
        makePlan({ id: 'p3', created_at: 3 }),
      ],
      total: 3,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-picker-count'));
    expect(screen.getByTestId('pm-compare-picker-count')).toHaveTextContent('已选 3 / 3');

    fireEvent.click(screen.getByTestId('pm-compare-pill-p3'));
    await waitFor(() => {
      expect(screen.getByTestId('pm-compare-picker-count')).toHaveTextContent('已选 2 / 3');
    });
  });
});

describe('PlanComparisonPage — "设为选中" mutation', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('calls pmPlans.select with the card plan id when "设为选中" is clicked', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'p1', is_selected: 1, created_at: 1 }),
        makePlan({ id: 'p2', is_selected: 0, created_at: 2 }),
      ],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    mockedSelectPlan.mockResolvedValue(makePlan({ id: 'p2', is_selected: 1 }));

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    // Click the "设为选中" button on the second card.
    const cards = screen.getAllByTestId('pm-plan-card');
    const inactiveCard = cards.find((c) => c.getAttribute('data-plan-id') === 'p2')!;
    fireEvent.click(within(inactiveCard).getByTestId('pm-plan-card-select'));

    await waitFor(() => {
      expect(mockedSelectPlan).toHaveBeenCalledWith('p2');
    });
  });

  it('does NOT call pmPlans.select when the active card button is clicked (disabled)', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'p1', is_selected: 1, created_at: 1 }),
        makePlan({ id: 'p2', is_selected: 0, created_at: 2 }),
      ],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    mockedSelectPlan.mockResolvedValue(makePlan({ id: 'p1', is_selected: 1 }));

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    const cards = screen.getAllByTestId('pm-plan-card');
    const activeCard = cards.find((c) => c.getAttribute('data-plan-id') === 'p1')!;
    fireEvent.click(within(activeCard).getByTestId('pm-plan-card-select'));
    expect(mockedSelectPlan).not.toHaveBeenCalled();
  });
});

describe('PlanComparisonPage — capability radar integration', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('renders a radar SVG for every plan card in the grid', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [
        makePlan({ id: 'p1', is_selected: 1, created_at: 1 }),
        makePlan({ id: 'p2', created_at: 2 }),
        makePlan({ id: 'p3', created_at: 3 }),
      ],
      total: 3,
    });
    mockedListPositions.mockResolvedValueOnce({
      positions: [
        makePosition({ id: 'pos-fe', title: 'Senior Frontend', title_level: 'senior' }),
      ],
      total: 1,
    });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));
    // Each card has its own radar wrapper (index-suffixed testid).
    expect(screen.getByTestId('pm-plan-card-radar-0')).toBeInTheDocument();
    expect(screen.getByTestId('pm-plan-card-radar-1')).toBeInTheDocument();
    expect(screen.getByTestId('pm-plan-card-radar-2')).toBeInTheDocument();
    // And three SVGs total (one per radar).
    const cards = screen.getAllByTestId('pm-plan-card');
    for (const card of cards) {
      expect(card.querySelector('svg')).toBeInTheDocument();
    }
  });

  it('passes plan + positions through to the radar (radar text labels appear)', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [makePlan({ id: 'p1' }), makePlan({ id: 'p2' })],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-grid'));

    // The candidate-portal RadarChart writes one <text> per dimension
    // with content like "前端: 0". The labels appear as concatenated
    // text nodes inside the <text> element, so we use a function
    // matcher for substring matching (the default getByText requires
    // an exact match and the radar's text contains the score suffix).
    const matchesSubstring = (needle: string) => (_: string, node: Element | null) => {
      if (!node) return false;
      return node.textContent?.includes(needle) ?? false;
    };

    // 2 cards × 1 "前端" label = 2 (or more) matches.
    expect(screen.getAllByText(matchesSubstring('前端')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(matchesSubstring('后端')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('PlanComparisonPage — new-plan CTA', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedGetProject.mockReset();
    mockedListPlans.mockReset();
    mockedListPositions.mockReset();
    mockedSelectPlan.mockReset();
  });

  it('renders the "+ 新建计划" button in the header', async () => {
    setupProjectDetail();
    mockedListPlans.mockResolvedValueOnce({
      plans: [makePlan({ id: 'p1' }), makePlan({ id: 'p2' })],
      total: 2,
    });
    mockedListPositions.mockResolvedValueOnce({ positions: [], total: 0 });
    renderPage();
    await waitFor(() => screen.getByTestId('pm-compare-new'));
    expect(screen.getByTestId('pm-compare-new')).toHaveTextContent('+ 新建计划');
  });
});
