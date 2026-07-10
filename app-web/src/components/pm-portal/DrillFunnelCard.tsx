// ============================================================================
// DrillFunnelCard (Task 3 / S1 redesign)
// ============================================================================
//
// Single stage of the horizontal 4-stage drill funnel rendered on the S1
// (Global Snapshot) page. Each card carries:
//   - a circled ordinal (①/②/③/④) so the eye scans left-to-right
//   - a stage label (项目 / 岗位 / 候选人 / 匹配) keyed via stage-tokens
//   - the headline count for the stage
//   - an optional sub-list (status breakdown, distinct candidates, etc.)
//
// Stage-specific colours come from the shared stage-tokens module so the
// visual language matches the rest of the workbench (sidebar / sandbox /
// matches). Clicking the card fires the parent-provided onClick — the
// parent decides where to drill (projects → /admin/pm/projects, etc.).

import { stageColor, stageBg, stageLabel, type Stage } from './stage-tokens';

interface SubItem { label: string; value: number; }
interface Props {
  stage: Stage;
  count: number;
  ordinal: '①' | '②' | '③' | '④';
  subItems: SubItem[];
  onClick: () => void;
}

export function DrillFunnelCard({ stage, count, ordinal, subItems, onClick }: Props) {
  return (
    <div
      className={`pm-funnel-stage pm-funnel-stage--${stage}`}
      data-testid={`pm-funnel-stage-${stage}`}
      style={{ borderColor: stageColor(stage), background: stageBg(stage) }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="pm-funnel-stage-ordinal">{ordinal}</div>
      <div className="pm-funnel-stage-label">{stageLabel(stage)}</div>
      <div className="pm-funnel-stage-count">{count}</div>
      {subItems.length > 0 && (
        <ul className="pm-funnel-stage-subs">
          {subItems.map((s) => (
            <li key={s.label}>{s.label} {s.value}</li>
          ))}
        </ul>
      )}
    </div>
  );
}