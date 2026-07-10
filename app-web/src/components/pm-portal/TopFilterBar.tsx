// ============================================================================
// TopFilterBar (Task 3 / S1 redesign)
// ============================================================================
//
// Slim filter strip pinned to the top of the S1 page. Three select chips
// (project / status / range) + three action buttons (refresh / export /
// create). Project chip is presentational for v1 (single-PM workbench —
// there is only one project namespace visible to the PM at a time), but
// the wire shape reserves the slot so Task 8 can drop in a real picker
// without touching call-sites.
//
// Status options mirror the PM workbench ProjectStatus lifecycle so the
// labels stay consistent with the Library page's status badges.
// Range options are relative windows (近 7/30/90 天 / 近 1 年) — the wire
// layer (Task 14's `/v1/pm/snapshot?range=...` filter) is wired up in a
// later task; for now the picks live in local component state.

interface Props {
  project: string;
  status: string;
  range: string;
  onProjectChange?: (v: string) => void;
  onStatusChange?: (v: string) => void;
  onRangeChange?: (v: string) => void;
  onRefresh: () => void;
  onExport: () => void;
  onCreate: () => void;
}

const STATUSES = ['全部', '进行中', '建模中', '已确认', '已收尾'];
const RANGES = ['近 7 天', '近 30 天', '近 90 天', '近 1 年'];

export function TopFilterBar({
  project, status, range,
  // onProjectChange is accepted for API parity (the chip is currently
  // presentational — Task 8 will swap it for a real picker) but is not
  // wired up yet. Prefix with `_` to silence the noUnusedParameters
  // check while keeping the prop in the public interface.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onProjectChange: _onProjectChange = () => {},
  onStatusChange = () => {},
  onRangeChange = () => {},
  onRefresh, onExport, onCreate,
}: Props) {
  return (
    <div className="pm-topfilter" data-testid="pm-topfilter">
      <span>📁 项目: {project} ▾</span>
      <label>
        状态:{' '}
        <select value={status} onChange={(e) => onStatusChange(e.target.value)} aria-label="状态过滤">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>
        时间:{' '}
        <select value={range} onChange={(e) => onRangeChange(e.target.value)} aria-label="时间范围">
          {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>
        <button className="pm-btn-secondary" onClick={onRefresh} data-testid="pm-topfilter-refresh">🔄 刷新</button>
        <button className="pm-btn-secondary" onClick={onExport} data-testid="pm-topfilter-export">📥 导出</button>
      </span>
      <button className="pm-btn-primary" onClick={onCreate} data-testid="pm-topfilter-create">+ 新建项目</button>
    </div>
  );
}