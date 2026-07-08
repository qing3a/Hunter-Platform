import { useMemo } from 'react';
import { formatBudgetYuan } from './ProjectCard';
import {
  type Plan,
  type Position,
  type Project,
} from '../../api/pm-portal';
import { CapabilityRadar, computeCapabilities, type CapabilityCategory } from './CapabilityRadar';

// ============================================================================
// StaffingPlanCard (S4 / Task 8)
// ============================================================================
//
// Single plan tile rendered inside the 3-up comparison grid. Shows:
//   - Plan name + selected ribbon (the plan that pmPlans.select()
//     marks as the project's active plan).
//   - Total HC
//   - Estimated cost (formatted via the shared formatBudgetYuan helper).
//   - Capability radar (5 dimensions).
//   - Risk tags — simple rule-based chips:
//       预算超支风险  if estimated_cost > project.budget_total / 2
//       人员紧张      if total_headcount < 5
//       依赖单一技能  if one capability dimension > 80% of the total score
//   - "设为选中" button — wired to onSelect callback (the page owns the
//     network call so it can invalidate the React Query cache + show a
//     toast).
//
// The card is a pure presentational component — no fetching, no state
// beyond what's needed for the click handler. The page passes positions
// in so the card can compute the radar scores without re-querying.
//
// All interactive elements have a `data-testid` so the test file can
// drive them by selector rather than text scraping.

export type RiskTagId = 'over_budget' | 'under_staffed' | 'single_skill';

export const RISK_TAGS: { id: RiskTagId; label: string; tone: 'amber' | 'red' | 'blue' }[] = [
  { id: 'over_budget', label: '预算超支风险', tone: 'red' },
  { id: 'under_staffed', label: '人员紧张', tone: 'amber' },
  { id: 'single_skill', label: '依赖单一技能', tone: 'blue' },
];

/**
 * Compute the list of risk tags that apply to a plan. Exported so the
 * test file can assert the rule table in isolation.
 *
 * Rules (kept simple for v1 — see task spec):
 *   - over_budget:  estimated_cost > budget_total / 2
 *   - under_staffed: total_headcount < 5
 *   - single_skill:  the highest of the 5 capability scores is ≥ 80% of
 *                    the sum of all 5 (i.e. the plan is heavily skewed
 *                    to one category)
 *
 * When the plan doesn't supply the data needed to evaluate a rule, that
 * rule is omitted (not "false"). E.g. a plan with no estimated_cost
 * doesn't trigger over_budget.
 */
export function computeRiskTags(
  plan: Plan,
  project: Project | null,
  positions: Position[],
): RiskTagId[] {
  const tags: RiskTagId[] = [];

  // 1. over_budget
  if (
    plan.estimated_cost != null &&
    project?.budget_total != null &&
    project.budget_total > 0 &&
    plan.estimated_cost > project.budget_total / 2
  ) {
    tags.push('over_budget');
  }

  // 2. under_staffed
  if (plan.total_headcount > 0 && plan.total_headcount < 5) {
    tags.push('under_staffed');
  }

  // 3. single_skill
  const caps = computeCapabilities(plan, positions);
  const total = (Object.keys(caps) as CapabilityCategory[]).reduce(
    (sum, k) => sum + caps[k],
    0,
  );
  if (total > 0) {
    const max = Math.max(...(Object.values(caps) as number[]));
    if (max / total >= 0.8) {
      tags.push('single_skill');
    }
  }

  return tags;
}

interface StaffingPlanCardProps {
  plan: Plan;
  /** Used to evaluate the `over_budget` risk tag. May be null while loading. */
  project: Project | null;
  /** Position lookup map (shared with sibling cards). */
  positions: Position[];
  /** Whether this is the project's currently selected plan (from `is_selected=1`). */
  isSelected: boolean;
  /** Whether the card is currently being submitted (spinner / disable button). */
  isSelecting?: boolean;
  /** Position in the comparison row, used to disambiguate testids when 3 cards share the page. */
  index: number;
  /** Called when the "设为选中" button is clicked. */
  onSelect: (planId: string) => void;
}

export function StaffingPlanCard({
  plan,
  project,
  positions,
  isSelected,
  isSelecting = false,
  index,
  onSelect,
}: StaffingPlanCardProps) {
  const riskTags = useMemo(
    () => computeRiskTags(plan, project, positions),
    [plan, project, positions],
  );

  return (
    <article
      className={`pm-plan-card${isSelected ? ' pm-plan-card-selected' : ''}`}
      data-testid="pm-plan-card"
      data-plan-id={plan.id}
      data-selected={isSelected ? 'true' : 'false'}
    >
      <header className="pm-plan-card-header">
        <h3 className="pm-plan-card-name" data-testid="pm-plan-card-name">
          {plan.name}
        </h3>
        {isSelected && (
          <span className="pm-plan-card-selected-ribbon" data-testid="pm-plan-card-selected-ribbon">
            当前选中
          </span>
        )}
      </header>

      {plan.description && (
        <p className="pm-plan-card-description" data-testid="pm-plan-card-description">
          {plan.description}
        </p>
      )}

      <dl className="pm-plan-card-meta">
        <div className="pm-plan-card-meta-row">
          <dt>总 HC</dt>
          <dd data-testid="pm-plan-card-headcount">{plan.total_headcount}</dd>
        </div>
        <div className="pm-plan-card-meta-row">
          <dt>估算成本</dt>
          <dd data-testid="pm-plan-card-cost">
            {formatBudgetYuan(plan.estimated_cost)}
          </dd>
        </div>
      </dl>

      <CapabilityRadar plan={plan} positions={positions} size={220} index={index} />

      <ul className="pm-plan-card-tags" data-testid="pm-plan-card-tags">
        {riskTags.length === 0 ? (
          <li className="pm-plan-card-tag-empty" data-testid="pm-plan-card-tag-empty">
            暂无风险标签
          </li>
        ) : (
          riskTags.map((id) => {
            const tag = RISK_TAGS.find((t) => t.id === id)!;
            return (
              <li
                key={id}
                className={`pm-plan-card-tag pm-plan-card-tag-${tag.tone}`}
                data-testid={`pm-plan-card-tag-${id}`}
                data-tone={tag.tone}
              >
                {tag.label}
              </li>
            );
          })
        )}
      </ul>

      <div className="pm-plan-card-footer">
        <button
          type="button"
          className="pm-btn-primary pm-plan-card-select"
          data-testid="pm-plan-card-select"
          onClick={() => onSelect(plan.id)}
          disabled={isSelected || isSelecting}
        >
          {isSelected
            ? '已选中'
            : isSelecting
              ? '提交中...'
              : '设为选中'}
        </button>
      </div>
    </article>
  );
}
