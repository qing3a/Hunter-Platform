import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  employerCandidates,
  type BrowseTalentParams,
  type TalentPreview,
} from '../../api/employer';
import { CandidatePreviewCard } from '../../components/employer-portal/CandidatePreviewCard';
import {
  EmployerFilterBar,
  EMPTY_FILTER,
  type EmployerFilter,
} from '../../components/employer-portal/EmployerFilterBar';

// ============================================================================
// BrowseTalentPage (Employer Portal — Task 6)
//
// Public-pool search for the logged-in employer. Backed by
// GET /v1/employer/talent (see src/main/routes/employer.ts → browseTalent).
//
// Layout
// ------
//   ┌──────────────┬────────────────────────────────────┐
//   │ FilterBar    │ Header                             │
//   │              │ Grid (CandidatePreviewCard × N)    │
//   │              │                                    │
//   └──────────────┴────────────────────────────────────┘
//
// State
// -----
//   - The filter sidebar is fully controlled — `filter` is the source of
//     truth. Every chip / input change writes through `setFilter`, which
//     triggers a React-Query refetch because `queryKey` references the
//     serialised filter shape.
//   - We translate `EmployerFilter` → `BrowseTalentParams` (the API
//     client's input shape) inside `buildBrowseParams`. Only non-empty
//     fields are forwarded so the URLSearchParams builder in
//     `employerCandidates.browse` doesn't serialise blanks.
//   - 表达兴趣 / 解锁 from a talent-browse card are surfaced but
//     intentionally not wired at this layer. Both endpoints target
//     recommendation ids (POST /v1/employer/recommendations/:id/…),
//     not talent-browse ids. A future task can extend the card with a
//     "create recommendation" affordance; for v1 the buttons are
//     inert placeholders so the affordance is visible in the UI.
// ============================================================================

/**
 * Convert the page's internal `EmployerFilter` (multi-select arrays) into
 * the API client's `BrowseTalentParams` (single-value + scalar fields).
 *
 *   - `industry[]` → first element only (the backend's `browseTalent`
 *     handler compares against a single `c.industry` column). v1 keeps
 *     the UI multi-select for forward-compat but caps the wire-format
 *     to a single value — a subsequent task will relax the server.
 *   - `level[]` → first element only (same reason).
 *   - `skills[]` → array (backend OR-matches any element in the array).
 *   - `salary_min` / `salary_max` → numeric scalars.
 */
function buildBrowseParams(filter: EmployerFilter): BrowseTalentParams | undefined {
  const params: BrowseTalentParams = {};
  if (filter.industry.length > 0) params.industry = filter.industry[0];
  if (filter.level.length > 0) params.title_level = filter.level[0];
  if (filter.skills.length > 0) params.skills = filter.skills;
  if (filter.salary_min != null) params.min_salary = filter.salary_min;
  if (filter.salary_max != null) params.max_salary = filter.salary_max;
  return Object.keys(params).length === 0 ? undefined : params;
}

export function BrowseTalentPage() {
  const [filter, setFilter] = useState<EmployerFilter>(EMPTY_FILTER);

  // React-Query keys by the filter shape — every chip / keystroke triggers
  // a new refetch. The backend caps browse at 100 results, so the wire
  // payload is small and the refetch is cheap.
  const browseParams = useMemo(() => buildBrowseParams(filter), [filter]);

  const browseQuery = useQuery<TalentPreview[]>({
    queryKey: ['employer', 'candidates', 'browse', browseParams ?? 'all'],
    queryFn: () => employerCandidates.browse(browseParams),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const candidates = browseQuery.data ?? [];

  // ---- Render: loading ----
  if (browseQuery.isLoading) {
    return (
      <div className="employer-candidates" data-testid="employer-candidates-loading">
        加载中…
      </div>
    );
  }

  // ---- Render: error ----
  if (browseQuery.isError) {
    return (
      <div className="employer-candidates" data-testid="employer-candidates-root">
        <header className="employer-candidates-header">
          <h1 className="employer-candidates-title" data-testid="employer-candidates-title">
            浏览候选人
          </h1>
        </header>
        <div className="employer-candidates-error" data-testid="employer-candidates-error">
          加载失败:{String((browseQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  return (
    <div className="employer-candidates" data-testid="employer-candidates-root">
      <header className="employer-candidates-header">
        <h1 className="employer-candidates-title" data-testid="employer-candidates-title">
          浏览候选人
        </h1>
        <span className="employer-candidates-count" data-testid="employer-candidates-count">
          {candidates.length} 位候选人
        </span>
      </header>

      <div className="employer-candidates-layout">
        <EmployerFilterBar value={filter} onChange={setFilter} />

        <section className="employer-candidates-main">
          {candidates.length === 0 ? (
            <div className="employer-candidates-empty" data-testid="employer-candidates-empty">
              暂无匹配的候选人。试试调整筛选条件。
            </div>
          ) : (
            <div className="employer-candidate-grid" data-testid="employer-candidates-grid">
              {candidates.map((c) => (
                <CandidatePreviewCard key={c.anonymized_id} candidate={c} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}