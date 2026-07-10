import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  StaffingPlanCard,
  computeRiskTags,
} from '../StaffingPlanCard';
import {
  categorizePosition,
  computeCapabilities,
  CAPABILITY_LABELS,
  LEVEL_SCORE,
} from '../CapabilityRadar';
import type { Plan, Position, Project } from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    project_id: 'proj-1',
    name: 'Plan A',
    description: 'Standard plan',
    total_headcount: 10,
    estimated_cost: 5_000_000, // 5万 fen
    positions_json: [],
    is_selected: 0,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    pm_user_id: 'pm-1',
    name: 'Test Project',
    target: null,
    budget_total: 20_000_000, // 20万 fen
    start_at: null,
    end_at: null,
    current_team: null,
    status: 'active',
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

function renderCard(
  props: Partial<React.ComponentProps<typeof StaffingPlanCard>> = {},
) {
  const onSelect = vi.fn();
  const utils = render(
    <StaffingPlanCard
      plan={props.plan ?? makePlan()}
      project={props.project ?? null}
      positions={props.positions ?? []}
      isSelected={props.isSelected ?? false}
      isSelecting={props.isSelecting ?? false}
      index={props.index ?? 0}
      onSelect={props.onSelect ?? onSelect}
    />,
  );
  return { ...utils, onSelect };
}

// ---- Tests ----------------------------------------------------------------

describe('StaffingPlanCard — basic rendering', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the plan name', () => {
    renderCard({ plan: makePlan({ name: 'Q4 Hiring Plan' }) });
    expect(screen.getByTestId('pm-plan-card-name')).toHaveTextContent('Q4 Hiring Plan');
  });

  it('renders the description when present', () => {
    renderCard({ plan: makePlan({ description: 'Hire 5 engineers in Q4' }) });
    expect(screen.getByTestId('pm-plan-card-description')).toHaveTextContent('Hire 5 engineers in Q4');
  });

  it('omits the description when null', () => {
    renderCard({ plan: makePlan({ description: null }) });
    expect(screen.queryByTestId('pm-plan-card-description')).toBeNull();
  });

  it('renders the total headcount', () => {
    renderCard({ plan: makePlan({ total_headcount: 25 }) });
    expect(screen.getByTestId('pm-plan-card-headcount')).toHaveTextContent('25');
  });

  it('renders the estimated cost via formatBudgetYuan (5_000_000 fen → ¥5.0万)', () => {
    renderCard({ plan: makePlan({ estimated_cost: 5_000_000 }) });
    expect(screen.getByTestId('pm-plan-card-cost')).toHaveTextContent('¥5.0万');
  });

  it('renders "—" when estimated_cost is null', () => {
    renderCard({ plan: makePlan({ estimated_cost: null }) });
    expect(screen.getByTestId('pm-plan-card-cost')).toHaveTextContent('-');
  });

  it('exposes the plan id via data-plan-id for test selection', () => {
    renderCard({ plan: makePlan({ id: 'plan-xyz' }) });
    expect(screen.getByTestId('pm-plan-card').getAttribute('data-plan-id')).toBe('plan-xyz');
  });
});

describe('StaffingPlanCard — selected state', () => {
  beforeEach(() => {
    cleanup();
  });

  it('applies the pm-plan-card-selected class when isSelected=true', () => {
    renderCard({ isSelected: true });
    const card = screen.getByTestId('pm-plan-card');
    expect(card.className).toContain('pm-plan-card-selected');
    expect(card.getAttribute('data-selected')).toBe('true');
  });

  it('shows the "当前选中" ribbon when isSelected=true', () => {
    renderCard({ isSelected: true });
    expect(screen.getByTestId('pm-plan-card-selected-ribbon')).toBeInTheDocument();
  });

  it('hides the ribbon when isSelected=false', () => {
    renderCard({ isSelected: false });
    expect(screen.queryByTestId('pm-plan-card-selected-ribbon')).toBeNull();
  });

  it('disables the "设为选中" button when already selected', () => {
    renderCard({ isSelected: true });
    const btn = screen.getByTestId('pm-plan-card-select') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain('已选中');
  });

  it('disables the button while isSelecting is true', () => {
    renderCard({ isSelected: false, isSelecting: true });
    const btn = screen.getByTestId('pm-plan-card-select') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain('提交中');
  });
});

describe('StaffingPlanCard — interactions', () => {
  beforeEach(() => {
    cleanup();
  });

  it('calls onSelect with the plan id when the button is clicked', () => {
    const { onSelect } = renderCard({ plan: makePlan({ id: 'plan-abc' }) });
    fireEvent.click(screen.getByTestId('pm-plan-card-select'));
    expect(onSelect).toHaveBeenCalledWith('plan-abc');
  });

  it('does NOT call onSelect when the button is disabled (already selected)', () => {
    const { onSelect } = renderCard({ isSelected: true });
    fireEvent.click(screen.getByTestId('pm-plan-card-select'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('StaffingPlanCard — risk tags', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders no risk tags and a "暂无风险标签" hint for a healthy plan', () => {
    const plan = makePlan({
      total_headcount: 10,
      estimated_cost: 1_000_000,
    });
    const project = makeProject({ budget_total: 20_000_000 });
    renderCard({ plan, project });
    expect(screen.getByTestId('pm-plan-card-tag-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-plan-card-tag-over_budget')).toBeNull();
    expect(screen.queryByTestId('pm-plan-card-tag-under_staffed')).toBeNull();
    expect(screen.queryByTestId('pm-plan-card-tag-single_skill')).toBeNull();
  });

  it('flags 预算超支风险 when estimated_cost > budget_total / 2', () => {
    const plan = makePlan({ estimated_cost: 15_000_000 }); // 15万 fen
    const project = makeProject({ budget_total: 20_000_000 }); // 20万 fen
    renderCard({ plan, project });
    expect(screen.getByTestId('pm-plan-card-tag-over_budget')).toBeInTheDocument();
  });

  it('does NOT flag 预算超支风险 when estimated_cost ≤ budget_total / 2', () => {
    const plan = makePlan({ estimated_cost: 5_000_000 });
    const project = makeProject({ budget_total: 20_000_000 });
    renderCard({ plan, project });
    expect(screen.queryByTestId('pm-plan-card-tag-over_budget')).toBeNull();
  });

  it('flags 人员紧张 when total_headcount < 5', () => {
    renderCard({ plan: makePlan({ total_headcount: 3 }) });
    expect(screen.getByTestId('pm-plan-card-tag-under_staffed')).toBeInTheDocument();
  });

  it('flags 依赖单一技能 when one capability dimension dominates (≥ 80% of total)', () => {
    // 1 staff backend = 100. The radar caps per dim at 100, so backend
    // = 100 and every other dim = 0. 100/100 = 100% → single_skill.
    const plan = makePlan({
      positions_json: [{ position_id: 'p1', count: 1 }],
    });
    const positions: Position[] = [
      makePosition({ id: 'p1', title: 'Staff Backend Engineer', title_level: 'staff' }),
    ];
    renderCard({ plan, positions });
    expect(screen.getByTestId('pm-plan-card-tag-single_skill')).toBeInTheDocument();
  });

  it('does NOT flag 依赖单一技能 when capabilities are balanced', () => {
    // 1 senior frontend + 1 senior backend → 75 + 75 = 150, no dim
    // hits 80% (each is 50%).
    const plan = makePlan({
      positions_json: [
        { position_id: 'p1', count: 1 },
        { position_id: 'p2', count: 1 },
      ],
    });
    const positions: Position[] = [
      makePosition({ id: 'p1', title: 'Senior Frontend', title_level: 'senior' }),
      makePosition({ id: 'p2', title: 'Senior Backend', title_level: 'senior' }),
    ];
    renderCard({ plan, positions });
    expect(screen.queryByTestId('pm-plan-card-tag-single_skill')).toBeNull();
  });

  it('can show multiple risk tags at the same time', () => {
    const plan = makePlan({
      total_headcount: 3,             // under_staffed
      estimated_cost: 15_000_000,     // over_budget (vs 20M budget / 2 = 10M)
      positions_json: [{ position_id: 'p1', count: 1 }],
    });
    const project = makeProject({ budget_total: 20_000_000 });
    const positions: Position[] = [
      makePosition({ id: 'p1', title: 'Staff Frontend Engineer', title_level: 'staff' }),
    ];
    renderCard({ plan, project, positions });
    expect(screen.getByTestId('pm-plan-card-tag-over_budget')).toBeInTheDocument();
    expect(screen.getByTestId('pm-plan-card-tag-under_staffed')).toBeInTheDocument();
    expect(screen.getByTestId('pm-plan-card-tag-single_skill')).toBeInTheDocument();
  });
});

describe('StaffingPlanCard — capability radar (smoke test)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the radar SVG with 5 dimension labels', () => {
    const plan = makePlan();
    const positions: Position[] = [];
    renderCard({ plan, positions, index: 0 });
    // The card mounts a RadarChart inside the pm-plan-card-radar-0 wrapper.
    // Scope to that wrapper — the card now also has a TriangleRadar SVG
    // above the capability radar, so a bare `container.querySelector('svg')`
    // would pick up the triangle (3 text labels), not the radar (5).
    const radarWrapper = screen.getByTestId('pm-plan-card-radar-0');
    const svg = radarWrapper.querySelector('svg');
    expect(svg).toBeInTheDocument();
    // 5 text labels (one per dimension).
    expect(svg!.querySelectorAll('text')).toHaveLength(5);
  });
});

describe('StaffingPlanCard — S4 triangle radar + locked ribbon (Task 9)', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the TriangleRadar with the 3-axis testid', () => {
    renderCard({ plan: makePlan() });
    expect(screen.getByTestId('pm-triangle-radar')).toBeInTheDocument();
  });

  it('renders the LockedRibbon when plan.is_selected === 1', () => {
    renderCard({ plan: makePlan({ is_selected: 1 }) });
    expect(screen.getByTestId('pm-locked-ribbon')).toBeInTheDocument();
  });

  it('does not render the LockedRibbon when plan.is_selected === 0', () => {
    renderCard({ plan: makePlan({ is_selected: 0 }) });
    expect(screen.queryByTestId('pm-locked-ribbon')).not.toBeInTheDocument();
  });
});

// ---- Pure-function coverage (computeRiskTags, categorizePosition, ...) ----

describe('categorizePosition', () => {
  it.each([
    ['高级前端工程师', 'frontend'],
    ['Senior Frontend Engineer', 'frontend'],
    ['vue developer', 'frontend'],
    ['React Native Developer', 'frontend'],
    ['后端工程师', 'backend'],
    ['Senior Backend Engineer', 'backend'],
    ['iOS Developer', 'mobile'],
    ['Android Engineer', 'mobile'],
    ['算法工程师', 'data'],
    ['AI Engineer', 'data'],
    ['数据工程师', 'data'],
    ['UI 设计师', 'design'],
    ['Product Designer', 'design'],
  ])('categorises "%s" as %s', (title, expected) => {
    expect(categorizePosition(title)).toBe(expected);
  });

  it('returns null for an unrecognised title', () => {
    expect(categorizePosition('Product Manager')).toBeNull();
    expect(categorizePosition('')).toBeNull();
  });
});

describe('computeCapabilities', () => {
  it('returns all zeros for a plan with no positions', () => {
    const caps = computeCapabilities(makePlan({ positions_json: [] }), []);
    expect(caps).toEqual({ frontend: 0, backend: 0, mobile: 0, data: 0, design: 0 });
  });

  it('scores 25 / 50 / 75 / 100 per junior / mid / senior / staff position', () => {
    const plan = makePlan({
      positions_json: [
        { position_id: 'p1', count: 1 },
        { position_id: 'p2', count: 1 },
        { position_id: 'p3', count: 1 },
        { position_id: 'p4', count: 1 },
      ],
    });
    const positions: Position[] = [
      makePosition({ id: 'p1', title: 'Junior Frontend', title_level: 'junior' }),
      makePosition({ id: 'p2', title: 'Mid Backend', title_level: 'mid' }),
      makePosition({ id: 'p3', title: 'Senior Mobile', title_level: 'senior' }),
      makePosition({ id: 'p4', title: 'Staff Data', title_level: 'staff' }),
    ];
    const caps = computeCapabilities(plan, positions);
    expect(caps.frontend).toBe(LEVEL_SCORE.junior);
    expect(caps.backend).toBe(LEVEL_SCORE.mid);
    expect(caps.mobile).toBe(LEVEL_SCORE.senior);
    expect(caps.data).toBe(LEVEL_SCORE.staff);
    expect(caps.design).toBe(0);
  });

  it('caps each dimension at 100', () => {
    const plan = makePlan({
      positions_json: [
        { position_id: 'p1', count: 3 }, // 3 senior frontends = 3 * 75 = 225 → cap 100
      ],
    });
    const positions: Position[] = [
      makePosition({ id: 'p1', title: 'Senior Frontend', title_level: 'senior' }),
    ];
    const caps = computeCapabilities(plan, positions);
    expect(caps.frontend).toBe(100);
  });

  it('skips positions whose title has no matching category', () => {
    const plan = makePlan({
      positions_json: [{ position_id: 'p1', count: 1 }],
    });
    const positions: Position[] = [
      makePosition({ id: 'p1', title: 'Product Manager', title_level: 'senior' }),
    ];
    const caps = computeCapabilities(plan, positions);
    expect(caps).toEqual({ frontend: 0, backend: 0, mobile: 0, data: 0, design: 0 });
  });

  it('skips positions whose id is not in the position map', () => {
    const plan = makePlan({
      positions_json: [{ position_id: 'missing', count: 1 }],
    });
    const positions: Position[] = [];
    const caps = computeCapabilities(plan, positions);
    expect(caps).toEqual({ frontend: 0, backend: 0, mobile: 0, data: 0, design: 0 });
  });
});

describe('computeRiskTags', () => {
  it('returns an empty list for a healthy plan', () => {
    const plan = makePlan({ total_headcount: 10, estimated_cost: 1_000_000 });
    const project = makeProject({ budget_total: 20_000_000 });
    expect(computeRiskTags(plan, project, [])).toEqual([]);
  });

  it('does not flag over_budget when project budget is null', () => {
    const plan = makePlan({ estimated_cost: 99_000_000 });
    const project = makeProject({ budget_total: null });
    expect(computeRiskTags(plan, project, [])).toEqual([]);
  });

  it('does not flag over_budget when plan cost is null', () => {
    const plan = makePlan({ estimated_cost: null });
    const project = makeProject({ budget_total: 20_000_000 });
    expect(computeRiskTags(plan, project, [])).toEqual([]);
  });

  it('does not flag over_budget when budget_total is 0 (avoids div-by-zero)', () => {
    const plan = makePlan({ estimated_cost: 1_000_000 });
    const project = makeProject({ budget_total: 0 });
    expect(computeRiskTags(plan, project, [])).toEqual([]);
  });
});

// Sanity check: the capability category labels match the values rendered.
describe('CAPABILITY_LABELS', () => {
  it('has the 5 expected Chinese labels', () => {
    expect(CAPABILITY_LABELS.frontend).toBe('前端');
    expect(CAPABILITY_LABELS.backend).toBe('后端');
    expect(CAPABILITY_LABELS.mobile).toBe('移动端');
    expect(CAPABILITY_LABELS.data).toBe('数据');
    expect(CAPABILITY_LABELS.design).toBe('设计');
  });
});
