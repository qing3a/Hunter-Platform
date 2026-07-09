import { useMemo, useState } from 'react';
import {
  POSITION_STATUS_LABELS,
  TITLE_LEVEL_LABELS,
  type Position,
  type PositionStatus,
  type TitleLevel,
} from '../../api/pm-portal';
import { PublishStatus } from './PublishStatus';

// ============================================================================
// PositionTable (S2 / Task 5 — PM UI Visual Fidelity)
// ============================================================================
//
// Table view of a project's positions. Columns: 岗位 / 级别 / 数量 / 必须技能 /
// 到岗 / 薪资 / ERP 状态. Mirrors the ProjectsLibraryPage table UX (the .pm-table
// class in pm-portal.css) so the visual treatment stays consistent.
//
// Filtering is client-side (the backend already returns a paged set, and
// the per-project list is bounded by the v1 PM workload). When the
// project gets a position detail page in a later task, row clicks will
// navigate there; for now the parent passes an `onRowClick` callback
// that can be wired or left as a no-op (Task 6/10 may add navigation).
//
// ERP status is rendered via PublishStatus. For v1 every row is hardcoded
// to `unpublished` because there is no publish-to-ERP backend yet; when
// the endpoint ships, this is the single place to wire in real state.

const STATUS_FILTERS: { value: PositionStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'open', label: POSITION_STATUS_LABELS.open },
  { value: 'paused', label: POSITION_STATUS_LABELS.paused },
  { value: 'filled', label: POSITION_STATUS_LABELS.filled },
];

const SKILLS_VISIBLE = 4;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatSalary(min: number | null, max: number | null): string {
  if (min == null && max == null) return '-';
  if (min != null && max != null) return `${min}-${max}`;
  return String(min ?? max);
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
              <th>岗位</th>
              <th>级别</th>
              <th>数量</th>
              <th>必须技能</th>
              <th>到岗</th>
              <th>薪资</th>
              <th>ERP 状态</th>
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
                  <td data-testid="pm-position-level">{levelLabel}</td>
                  <td data-testid="pm-position-headcount">
                    {p.headcount_filled} / {p.headcount_planned}
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
                  <td data-testid="pm-position-arrival">
                    <span style={{ color: 'var(--text-muted)' }}>-</span>
                  </td>
                  <td data-testid="pm-position-salary">
                    {formatSalary(p.salary_min, p.salary_max)}
                  </td>
                  <td data-testid="pm-position-erp">
                    <PublishStatus
                      status="unpublished"
                      onPublish={() => { window.alert('发布功能即将上线'); }}
                      onRepublish={() => { window.alert('重发功能即将上线'); }}
                    />
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