import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pmPlans,
  pmProjects,
  pmPositions,
  type Plan,
  type Position,
  type Project,
} from '../../api/pm-portal';
import { StaffingPlanCard } from '../../components/pm-portal/StaffingPlanCard';
import { useToast } from '@hunter-platform/shared-web/lib';

// ============================================================================
// PlanComparisonPage (S4 / Task 8)
// ============================================================================
//
// Side-by-side comparison of up to 3 staffing plans for a project. Used
// by PMs to weigh tradeoffs (headcount vs cost vs capability mix) and
// pick one as the project's "current" plan.
//
// Layout
// ------
//   1. Header          — "计划对比" title + "返回项目" + "+ 新建计划" CTA
//   2. Plan selector   — pill row of all plans; click to toggle inclusion
//                        in the comparison (capped at 3)
//   3. Comparison grid — 1 / 2 / 3 columns (responsive) of plan cards
//
// Selection state model
// ---------------------
// Two layers:
//   - "selected for comparison"   local React state (which plans the
//                                  PM is currently looking at, up to 3)
//   - "currently selected plan"   server-side (`plan.is_selected = 1`)
//                                  drives the highlighted card / ribbon
//
// The PM can flip the comparison pills without touching the project's
// active plan. The "设为选中" button inside a card is the only way to
// change the active plan; it calls `pmPlans.select(id)`.
//
// Auto-seed: on first load we pre-include the active plan + up to 2
// more (most recently created), so the page never lands empty if the
// project has at least 1 plan.
//
// Network
// -------
//   - pmProjects.get(id)      header data (project, positions, plans)
//   - pmPositions.list(id)    for the radar's keyword categorisation
//                             (joined to plan.positions_json client-side)
//   - pmPlans.select(id)      mutation that drives the active-plan
//                             highlight. On success we invalidate the
//                             list query and toast.
//
// Empty states
// ------------
//   - 0 plans in the project  → "暂无计划,请先创建"
//   - 1 plan in the project   → "至少需要 2 个计划才能对比"
//   - 0 / 1 selected for comparison (with ≥ 2 plans) →
//       "请选择 2-3 个计划进行对比"
//
// Routing
// -------
// The page reads `id` from the route param (`/admin/pm/projects/:id/compare`).
// Task 17 is responsible for registering the route in App.tsx — for
// now the test file mounts the page directly via MemoryRouter.

const MAX_COMPARE = 3;

function autoSelectIds(plans: Plan[]): string[] {
  // Auto-include the active plan first, then pad with the most recent
  // plans. The result is capped at MAX_COMPARE so the comparison grid
  // never overflows.
  const active = plans.find((p) => p.is_selected === 1);
  const sorted = [...plans].sort((a, b) => b.created_at - a.created_at);
  const ids: string[] = [];
  if (active) ids.push(active.id);
  for (const p of sorted) {
    if (ids.length >= MAX_COMPARE) break;
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}

export function PlanComparisonPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();

  // The user-controlled set of plan ids in the comparison grid. Capped
  // at MAX_COMPARE (3). Initial value is auto-seeded from the plans
  // query once it resolves (see useEffect below).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [autoSeeded, setAutoSeeded] = useState(false);

  // ---- Network: project detail ---------------------------------------
  // The project detail returns the project + its plans (we use the
  // legacy `plans: PlanSummary[]` for the empty-state check, but the
  // comparison cards need the real Plan rows — we fetch those from
  // pmPlans.list below).
  const projectQuery = useQuery({
    queryKey: ['pm', 'projects', 'get', projectId],
    queryFn: () => pmProjects.get(projectId!),
    enabled: Boolean(projectId),
  });

  // ---- Network: plans list -------------------------------------------
  const plansQuery = useQuery({
    queryKey: ['pm', 'plans', 'list', projectId],
    queryFn: () => pmPlans.list(projectId!),
    enabled: Boolean(projectId),
  });

  // ---- Network: positions list (for the radar categorisation) -------
  const positionsQuery = useQuery({
    queryKey: ['pm', 'positions', 'list', projectId],
    queryFn: () => pmPositions.list(projectId!),
    enabled: Boolean(projectId),
  });

  // ---- Mutation: set as selected -------------------------------------
  const selectMutation = useMutation({
    mutationFn: (planId: string) => pmPlans.select(planId),
    onSuccess: () => {
      push({ type: 'success', message: '已选为当前计划' });
      // Invalidate both list queries so the highlight moves.
      queryClient.invalidateQueries({ queryKey: ['pm', 'plans', 'list', projectId] });
      queryClient.invalidateQueries({ queryKey: ['pm', 'projects', 'get', projectId] });
    },
    onError: (e) => {
      push({ type: 'error', message: (e as Error).message || '操作失败' });
    },
  });

  const plans = plansQuery.data?.plans ?? [];
  const project: Project | null = projectQuery.data?.project ?? null;
  const positions: Position[] = positionsQuery.data?.positions ?? [];

  // Auto-seed the comparison selection once the plans query lands.
  // We only do this once per mount (the autoSeeded flag prevents the
  // user's manual toggles from being clobbered on refetch).
  useEffect(() => {
    if (autoSeeded) return;
    if (!plansQuery.data) return;
    if (plans.length === 0) {
      setAutoSeeded(true);
      return;
    }
    setSelectedIds(autoSelectIds(plans));
    setAutoSeeded(true);
  }, [plansQuery.data, plans.length, autoSeeded]);

  // Memoised lookup: planId -> Plan. Cards render by walking the
  // selectedIds list in order; we still need the Plan row to look up
  // headcount / cost / positions_json.
  const plansById = useMemo(() => {
    const m = new Map<string, Plan>();
    for (const p of plans) m.set(p.id, p);
    return m;
  }, [plans]);

  // ---- Selection helpers --------------------------------------------
  function togglePlan(planId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(planId)) {
        return prev.filter((x) => x !== planId);
      }
      if (prev.length >= MAX_COMPARE) {
        push({ type: 'info', message: `最多同时对比 ${MAX_COMPARE} 个计划` });
        return prev;
      }
      return [...prev, planId];
    });
  }

  // The plan object the page operates on (active plan) — sourced from
  // the live list so the highlight updates after a successful select.
  const activePlanId = useMemo(
    () => plans.find((p) => p.is_selected === 1)?.id ?? null,
    [plans],
  );

  // The visible cards (in the order the user picked). Unknown ids are
  // silently dropped (defensive — shouldn't happen since the chips
  // only render known plans, but it keeps the render function safe).
  const visibleCards = useMemo(
    () =>
      selectedIds
        .map((id) => plansById.get(id))
        .filter((p): p is Plan => Boolean(p)),
    [selectedIds, plansById],
  );

  // ---- Render gates --------------------------------------------------
  if (projectQuery.isLoading || plansQuery.isLoading) {
    return (
      <div className="pm-compare" data-testid="pm-compare-loading">
        加载中...
      </div>
    );
  }

  if (projectQuery.error) {
    return (
      <div className="pm-error" data-testid="pm-compare-error">
        加载失败: {(projectQuery.error as Error).message}
      </div>
    );
  }

  if (plansQuery.error) {
    return (
      <div className="pm-error" data-testid="pm-compare-plans-error">
        加载计划失败: {(plansQuery.error as Error).message}
      </div>
    );
  }

  // Empty state 1: no plans at all.
  if (plans.length === 0) {
    return (
      <div className="pm-compare" data-testid="pm-compare">
        <button
          type="button"
          className="pm-btn-link pm-compare-back"
          onClick={() => navigate(`/admin/pm/projects/${projectId}`)}
          data-testid="pm-compare-back"
        >
          ← 返回项目
        </button>
        <h1 className="pm-compare-title" data-testid="pm-compare-title">计划对比</h1>
        <div className="pm-empty" data-testid="pm-compare-empty">
          <p>暂无计划,请先创建</p>
          <p className="pm-empty-hint">
            计划用于汇总一段时间内的招聘目标、HC 和成本估算。创建至少 2 个计划后才能进行对比。
          </p>
        </div>
      </div>
    );
  }

  // Empty state 2: only 1 plan.
  if (plans.length === 1) {
    return (
      <div className="pm-compare" data-testid="pm-compare">
        <button
          type="button"
          className="pm-btn-link pm-compare-back"
          onClick={() => navigate(`/admin/pm/projects/${projectId}`)}
          data-testid="pm-compare-back"
        >
          ← 返回项目
        </button>
        <h1 className="pm-compare-title" data-testid="pm-compare-title">计划对比</h1>
        <div className="pm-empty" data-testid="pm-compare-single">
          <p>至少需要 2 个计划才能对比</p>
          <p className="pm-empty-hint">当前项目只有 1 个计划:{plans[0].name}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pm-compare" data-testid="pm-compare">
      <button
        type="button"
        className="pm-btn-link pm-compare-back"
        onClick={() => navigate(`/admin/pm/projects/${projectId}`)}
        data-testid="pm-compare-back"
      >
        ← 返回项目
      </button>

      <header className="pm-compare-header">
        <h1 className="pm-compare-title" data-testid="pm-compare-title">计划对比</h1>
        <button
          type="button"
          className="pm-btn-primary"
          data-testid="pm-compare-new"
          onClick={() => push({ type: 'info', message: '新建计划表单将在 Task 11 上线' })}
        >
          + 新建计划
        </button>
      </header>

      <section className="pm-compare-picker" data-testid="pm-compare-picker">
        <span className="pm-compare-picker-label">选择对比计划</span>
        <ul className="pm-compare-picker-list" role="list">
          {plans.map((p) => {
            const checked = selectedIds.includes(p.id);
            const disabled = !checked && selectedIds.length >= MAX_COMPARE;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`pm-compare-pill${checked ? ' active' : ''}`}
                  data-testid={`pm-compare-pill-${p.id}`}
                  data-plan-id={p.id}
                  data-active={checked ? 'true' : 'false'}
                  onClick={() => togglePlan(p.id)}
                  disabled={disabled}
                >
                  {checked ? '✓ ' : ''}
                  {p.name}
                  {p.is_selected === 1 && ' ★'}
                </button>
              </li>
            );
          })}
        </ul>
        <span className="pm-compare-picker-count" data-testid="pm-compare-picker-count">
          已选 {selectedIds.length} / {MAX_COMPARE}
        </span>
      </section>

      {visibleCards.length < 2 ? (
        <div className="pm-empty" data-testid="pm-compare-pick-hint">
          <p>请选择 2-3 个计划进行对比</p>
          <p className="pm-empty-hint">
            点击上方的计划标签以加入对比。最多支持 {MAX_COMPARE} 个计划横向并排查看。
          </p>
        </div>
      ) : (
        <section
          className="pm-compare-grid"
          data-testid="pm-compare-grid"
          data-card-count={visibleCards.length}
        >
          {visibleCards.map((p, idx) => (
            <StaffingPlanCard
              key={p.id}
              plan={p}
              project={project}
              positions={positions}
              isSelected={p.id === activePlanId}
              isSelecting={
                selectMutation.isPending && selectMutation.variables === p.id
              }
              index={idx}
              onSelect={(planId) => selectMutation.mutate(planId)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
