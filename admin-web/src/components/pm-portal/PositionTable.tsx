import { useMemo, useState } from 'react';
import {
  POSITION_STATUS_LABELS,
  TITLE_LEVEL_LABELS,
  type Position,
  type PositionStatus,
  type TitleLevel,
} from '../../api/pm-portal';

// ============================================================================
// PositionTable (S2 / Task 5)
// ============================================================================
//
// Table view of a project's positions. Columns: 标题 / 技能 / 职级 /
// 计划/已招 HC / 状态 / 操作. Mirrors the ProjectsLibraryPage table UX
// (the .pm-table class in pm-portal.css) so the visual treatment stays
// consistent.
//
// Filtering is client-side (the backend already returns a paged set, and
// the per-project list is bounded by the v1 PM workload). When the
// project gets a position detail page in a later task, row clicks will
// navigate there; for now the parent passes an `onRowClick` callback
// that can be wired or left as a no-op (Task 6/10 may add navigation).
//
// Status pill colors mirror the project status badge colors so the
// admin palette is consistent across lifecycle and recruitment state.

const STATUS_COLORS: Record<PositionStatus, string> = {
  open: '#10b981',    // green
  paused: '#f59e0b',  // amber
  filled: '#2563eb',  // blue
};

const STATUS_FILTERS: { value: PositionStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'open', label: POSITION_STATUS_LABELS.open },
  { value: 'paused', label: POSITION_STATUS_LABELS.paused },
  { value: 'filled', label: POSITION_STATUS_LABELS.filled },
];

const SKILLS_VISIBLE = 4;

function StatusBadge({ status }: { status: PositionStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="pm-position-status"
      data-status={status}
      data-testid="pm-position-status"
      style={{
        backgroundColor: color + '22',
        color,
        borderColor: color,
      }}
    >
      {POSITION_STATUS_LABELS[status]}
    </span>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface PositionTableProps {
  positions: Position[];
  loading: boolean;
  onRowClick?: (positionId: string) => void;
}

export function PositionTable({ positions, loading, onRowClick }: PositionTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PositionStatus | 'all'>('all');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions
      .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
      .filter((p) => (q ? p.title.toLowerCase().includes(q) : true));
  }, [positions, search, statusFilter]);

  if (loading) {
    return (
      <div className="pm-loading" data-testid="pm-positions-loading">
        加载中...
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="pm-empty" data-testid="pm-positions-empty">
        <p>暂无岗位</p>
        <p className="pm-empty-hint">点击「智能拆岗位」让 AI 帮你拆出第一批岗位,或手动新建。</p>
      </div>
    );
  }

  return (
    <div className="pm-positions">
      <div className="pm-filters" data-testid="pm-positions-filters">
        <input
          type="search"
          className="pm-input"
          placeholder="搜索岗位标题"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="pm-positions-search"
          aria-label="搜索岗位标题"
        />
        <select
          className="pm-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PositionStatus | 'all')}
          data-testid="pm-positions-status-filter"
          aria-label="状态筛选"
        >
          {STATUS_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="pm-empty" data-testid="pm-positions-no-match">
          <p>没有匹配的岗位</p>
          <p className="pm-empty-hint">试试调整搜索关键词或状态筛选</p>
        </div>
      ) : (
        <table className="pm-table" data-testid="pm-positions-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>技能</th>
              <th>职级</th>
              <th>计划/已招 HC</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const skills = p.required_skills;
              const visibleSkills = skills.slice(0, SKILLS_VISIBLE);
              const overflow = skills.length - visibleSkills.length;
              const titleLevel = p.title_level as TitleLevel | null;
              const levelLabel =
                titleLevel && titleLevel in TITLE_LEVEL_LABELS
                  ? TITLE_LEVEL_LABELS[titleLevel]
                  : '-';
              return (
                <tr
                  key={p.id}
                  className="pm-position-row"
                  data-testid="pm-position-row"
                  data-position-id={p.id}
                  onClick={onRowClick ? () => onRowClick(p.id) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  <td title={p.title}>
                    <span data-testid="pm-position-title">{truncate(p.title, 40)}</span>
                  </td>
                  <td data-testid="pm-position-skills">
                    {skills.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    ) : (
                      <>
                        {visibleSkills.join(', ')}
                        {overflow > 0 && ` +${overflow}`}
                      </>
                    )}
                  </td>
                  <td data-testid="pm-position-level">{levelLabel}</td>
                  <td data-testid="pm-position-headcount">
                    {p.headcount_filled} / {p.headcount_planned}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>
                    {onRowClick ? (
                      <button
                        type="button"
                        className="pm-btn-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowClick(p.id);
                        }}
                      >
                        查看
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
