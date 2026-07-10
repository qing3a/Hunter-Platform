// ============================================================================
// LibraryFilterBar (Task 14 / S9)
// ============================================================================
//
// Search input + source/annotation filter selects + table/card view
// toggle. Rendered by the Candidate Library page as the controls strip
// directly under the page header.
//
// Controlled component
// --------------------
// The bar is fully controlled — the page owns:
//   - filter values (search string, source channel, annotation bucket)
//   - view mode (table | card)
// The bar just renders + dispatches. View-mode persistence lives in
// the page (localStorage `pm.library.candidates.viewMode`).
//
// Why one component?
// ------------------
// Search + view-toggle + S9 source/annotation selects are conceptually
// the "filter" surface of the library; bundling them keeps the page
// component slim and makes the shape easy to test in isolation.
//
// The bar is intentionally dumb about WHERE results come from —
// the page wires the `onChange` callback to its client-side filter
// (no network).

export type LibraryViewMode = 'table' | 'card';

/** Allowed source filter values — mirrors the S9 dropdown options. */
export type LibrarySourceValue = 'all' | '内推' | '主动寻访' | '历史库' | 'HR转入';

/** Allowed annotation filter values — mirrors the S9 dropdown options. */
export type LibraryAnnotationValue = 'all' | 'starred' | 'noted';

/** Combined shape of all three filter inputs — Task 14 / S9. */
export interface LibraryFilterValue {
  search: string;
  source: LibrarySourceValue;
  annotation: LibraryAnnotationValue;
}

interface LibraryFilterBarProps {
  /** Current filter values (controlled). */
  value: LibraryFilterValue;
  /** Change handler — receives the next full filter shape. */
  onChange: (next: LibraryFilterValue) => void;
  /** Current view mode (controlled). */
  viewMode: LibraryViewMode;
  /** Change handler for the view toggle. */
  onViewModeChange: (next: LibraryViewMode) => void;
  /**
   * Optional placeholder override (defaults to "搜索候选人 (姓名 / 技能)") —
   * exposed so the tests can render a deterministic aria-label.
   */
  searchPlaceholder?: string;
}

/** Display labels + values for the source <select>. */
const SOURCE_OPTIONS: ReadonlyArray<{ value: LibrarySourceValue; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: '内推', label: '内推' },
  { value: '主动寻访', label: '主动寻访' },
  { value: '历史库', label: '历史库' },
  { value: 'HR转入', label: 'HR 转入' },
];

/** Display labels + values for the annotation <select>. */
const ANNOTATION_OPTIONS: ReadonlyArray<{ value: LibraryAnnotationValue; label: string }> = [
  { value: 'all', label: '全部标注' },
  { value: 'starred', label: '⭐ 我标记的' },
  { value: 'noted', label: '📝 有笔记的' },
];

export function LibraryFilterBar({
  value,
  onChange,
  viewMode,
  onViewModeChange,
  searchPlaceholder = '搜索候选人 (姓名 / 技能)',
}: LibraryFilterBarProps) {
  return (
    <div className="pm-filters" data-testid="pm-library-filters">
      <input
        type="search"
        className="pm-input"
        placeholder={searchPlaceholder}
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
        data-testid="pm-library-search"
        aria-label={searchPlaceholder}
      />
      <select
        className="pm-input pm-select"
        data-testid="pm-library-source"
        value={value.source}
        onChange={(e) => onChange({ ...value, source: e.target.value as LibrarySourceValue })}
        aria-label="按来源筛选"
      >
        {SOURCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        className="pm-input pm-select"
        data-testid="pm-library-annotation"
        value={value.annotation}
        onChange={(e) => onChange({ ...value, annotation: e.target.value as LibraryAnnotationValue })}
        aria-label="按标注筛选"
      >
        {ANNOTATION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="pm-view-toggle" role="group" aria-label="视图切换">
        <button
          type="button"
          className={`pm-view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
          data-testid="pm-library-view-table"
          data-active={viewMode === 'table'}
          onClick={() => onViewModeChange('table')}
        >
          表格
        </button>
        <button
          type="button"
          className={`pm-view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
          data-testid="pm-library-view-card"
          data-active={viewMode === 'card'}
          onClick={() => onViewModeChange('card')}
        >
          卡片
        </button>
      </div>
    </div>
  );
}