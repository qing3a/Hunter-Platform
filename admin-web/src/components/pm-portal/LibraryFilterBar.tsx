// ============================================================================
// LibraryFilterBar (Task 14 / S9)
// ============================================================================
//
// Search input + table/card view toggle. Rendered by the Candidate
// Library page as the controls strip directly under the page header.
//
// Controlled component
// --------------------
// The bar is fully controlled — the page owns:
//   - search string
//   - view mode (table | card)
// The bar just renders + dispatches. View-mode persistence lives in
// the page (localStorage `pm.library.candidates.viewMode`).
//
// Why one component?
// ------------------
// Search + view-toggle are conceptually the "filter" surface of the
// library; bundling them keeps the page component slim and makes the
// shape easy to test in isolation (Task 14 spec requires 5+ tests
// for this component alone).
//
// The bar is intentionally dumb about WHERE results come from —
// the page wires the `onSearch` callback to its client-side filter
// (no network).

export type LibraryViewMode = 'table' | 'card';

interface LibraryFilterBarProps {
  /** Current search query (controlled). */
  search: string;
  /** Change handler for the search input. */
  onSearch: (next: string) => void;
  /** Current view mode (controlled). */
  viewMode: LibraryViewMode;
  /** Change handler for the view toggle. */
  onViewMode: (next: LibraryViewMode) => void;
  /**
   * Optional placeholder override (defaults to "搜索候选人 (姓名 / 技能)") —
   * exposed so the tests can render a deterministic aria-label.
   */
  searchPlaceholder?: string;
}

export function LibraryFilterBar({
  search,
  onSearch,
  viewMode,
  onViewMode,
  searchPlaceholder = '搜索候选人 (姓名 / 技能)',
}: LibraryFilterBarProps) {
  return (
    <div className="pm-filters" data-testid="pm-library-filters">
      <input
        type="search"
        className="pm-input"
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        data-testid="pm-library-search"
        aria-label={searchPlaceholder}
      />
      <div className="pm-view-toggle" role="group" aria-label="视图切换">
        <button
          type="button"
          className={`pm-view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
          data-testid="pm-library-view-table"
          data-active={viewMode === 'table'}
          onClick={() => onViewMode('table')}
        >
          表格
        </button>
        <button
          type="button"
          className={`pm-view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
          data-testid="pm-library-view-card"
          data-active={viewMode === 'card'}
          onClick={() => onViewMode('card')}
        >
          卡片
        </button>
      </div>
    </div>
  );
}