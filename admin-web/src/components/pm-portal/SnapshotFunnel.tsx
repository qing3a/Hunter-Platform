import type { SnapshotFunnel as SnapshotFunnelData } from '../../api/pm-portal';

// ============================================================================
// SnapshotFunnel (Task 12 / S1)
// ============================================================================
//
// The 4-stage funnel that powers the Global Snapshot page. Each stage
// card shows:
//   - stage label       (项目 / 岗位 / 候选人 / 匹配)
//   - big count number
//   - sub-bullet rows   (status buckets / distinct count / avg score)
//
// Visual design mirrors SandboxFunnelCard (Task 9) but the data shape
// is different — we render funnel-stage aggregates, not per-position
// pipeline stages. Accent colors are picked to match the project's
// design tokens (blue = top-of-funnel, green = bottom-of-funnel).
//
// The funnel is purely presentational: no clicks, no keyboard
// handlers, no risk indicators. Drill-through is owned by other
// pages (ProjectsLibraryPage, PipelineSandboxPage, etc.).
//
// Stage labels are intentionally Chinese — the entire PM Workbench
// ships in zh-CN (per the original design doc).

interface SnapshotFunnelProps {
  funnel: SnapshotFunnelData;
}

interface StageMeta {
  key: 'projects' | 'positions' | 'candidates' | 'matches';
  label: string;
  /** Subtitle shown above the big number ("项目库" / "招聘中" / etc.) */
  subtitle: string;
  /** Accent key → maps to a CSS class for the card border. */
  accent: 'blue' | 'purple' | 'amber' | 'green';
  /** Extract the big number for this stage from the funnel data. */
  getCount: (f: SnapshotFunnelData) => number;
  /** Render the sub-bullets (status buckets etc.). */
  renderSubStats: (f: SnapshotFunnelData) => React.ReactNode;
}

const STAGES: StageMeta[] = [
  {
    key: 'projects',
    label: '项目',
    subtitle: '我管理的项目',
    accent: 'blue',
    getCount: (f) => f.projects.total,
    renderSubStats: (f) => (
      <ul className="pm-snapshot-funnel-bullets">
        <li>
          <span className="pm-snapshot-funnel-bullet-key">筹备中</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.projects.by_status.planning}</span>
        </li>
        <li>
          <span className="pm-snapshot-funnel-bullet-key">进行中</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.projects.by_status.active}</span>
        </li>
        <li>
          <span className="pm-snapshot-funnel-bullet-key">已暂停</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.projects.by_status.paused}</span>
        </li>
        <li>
          <span className="pm-snapshot-funnel-bullet-key">已完成</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.projects.by_status.completed}</span>
        </li>
        <li>
          <span className="pm-snapshot-funnel-bullet-key">已取消</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.projects.by_status.cancelled}</span>
        </li>
      </ul>
    ),
  },
  {
    key: 'positions',
    label: '岗位',
    subtitle: '招聘中 + 已暂停 + 已招满',
    accent: 'purple',
    getCount: (f) => f.positions.total,
    renderSubStats: (f) => (
      <>
        <ul className="pm-snapshot-funnel-bullets">
          <li>
            <span className="pm-snapshot-funnel-bullet-key">招聘中</span>
            <span className="pm-snapshot-funnel-bullet-val">{f.positions.by_status.open}</span>
          </li>
          <li>
            <span className="pm-snapshot-funnel-bullet-key">已暂停</span>
            <span className="pm-snapshot-funnel-bullet-val">{f.positions.by_status.paused}</span>
          </li>
          <li>
            <span className="pm-snapshot-funnel-bullet-key">已招满</span>
            <span className="pm-snapshot-funnel-bullet-val">{f.positions.by_status.filled}</span>
          </li>
        </ul>
        <div className="pm-snapshot-funnel-headcount">
          计划 {f.positions.headcount_planned_total} · 已填 {f.positions.headcount_filled_total}
        </div>
      </>
    ),
  },
  {
    key: 'candidates',
    label: '候选人',
    subtitle: '匹配中出现的人',
    accent: 'amber',
    getCount: (f) => f.candidates.distinct,
    renderSubStats: (f) => (
      <ul className="pm-snapshot-funnel-bullets">
        <li>
          <span className="pm-snapshot-funnel-bullet-key">匹配次数</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.candidates.total}</span>
        </li>
        <li>
          <span className="pm-snapshot-funnel-bullet-key">去重候选人数</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.candidates.distinct}</span>
        </li>
      </ul>
    ),
  },
  {
    key: 'matches',
    label: '匹配',
    subtitle: '系统生成的匹配项',
    accent: 'green',
    getCount: (f) => f.matches.total,
    renderSubStats: (f) => (
      <ul className="pm-snapshot-funnel-bullets">
        <li>
          <span className="pm-snapshot-funnel-bullet-key">匹配总数</span>
          <span className="pm-snapshot-funnel-bullet-val">{f.matches.total}</span>
        </li>
        <li>
          <span className="pm-snapshot-funnel-bullet-key">平均分</span>
          <span
            className="pm-snapshot-funnel-bullet-val"
            data-testid="pm-snapshot-funnel-matches-avg"
          >
            {f.matches.avg_score}
          </span>
        </li>
      </ul>
    ),
  },
];

export function SnapshotFunnel({ funnel }: SnapshotFunnelProps) {
  return (
    <div
      className="pm-snapshot-funnel"
      data-testid="pm-snapshot-funnel"
      aria-label="4 阶段全局漏斗"
    >
      {STAGES.map((stage) => {
        const count = stage.getCount(funnel);
        return (
          <div
            key={stage.key}
            className={`pm-snapshot-funnel-card pm-snapshot-funnel-card-${stage.accent}`}
            data-testid={`pm-snapshot-funnel-${stage.key}`}
            data-stage={stage.key}
            data-count={count}
          >
            <div className="pm-snapshot-funnel-card-header">
              <div className="pm-snapshot-funnel-card-label">{stage.label}</div>
              <div className="pm-snapshot-funnel-card-subtitle">{stage.subtitle}</div>
            </div>
            <div
              className="pm-snapshot-funnel-card-count"
              data-testid={`pm-snapshot-funnel-count-${stage.key}`}
            >
              {count}
            </div>
            <div className="pm-snapshot-funnel-card-substats">
              {stage.renderSubStats(funnel)}
            </div>
          </div>
        );
      })}
    </div>
  );
}