// ============================================================================
// EmployerFilterBar (Employer Portal — Task 6 Browse Talent)
//
// Filter sidebar for the talent pool. Four groups:
//
//   - industry  : multi-select chips (互联网/金融/教育/医疗/制造/消费/其他)
//   - level     : multi-select chips (junior / mid / senior / staff)
//   - skills    : free-text input, comma-separated, OR match (handled
//                 server-side by `browseTalent`)
//   - salary    : numeric min / max
//
// The component is fully controlled — `value` is the source of truth,
// every user gesture fires `onChange(next)` synchronously, and the page
// is responsible for translating the value into query params before
// calling `employerCandidates.browse`.
//
// Why a controlled component?
//   - The page wants to debounce or throttle server calls; debouncing
//     inside this component would force a refetch on every keystroke.
//   - The page may want to persist the filter to URL state (task #6
//     doesn't yet, but a follow-up could).
//
// All changes go through `update(patch)` which spreads the previous
// value and merges the patch — so callers don't have to thread the full
// object through.
// ============================================================================

export interface EmployerFilter {
  industry: string[];
  level: string[];
  skills: string[];
  salary_min: number | null;
  salary_max: number | null;
}

/** Empty-filter constant for "reset" semantics. */
export const EMPTY_FILTER: EmployerFilter = {
  industry: [],
  level: [],
  skills: [],
  salary_min: null,
  salary_max: null,
};

const INDUSTRY_OPTIONS = ['互联网', '金融', '教育', '医疗', '制造', '消费', '其他'] as const;
const LEVEL_OPTIONS = ['junior', 'mid', 'senior', 'staff'] as const;

/**
 * Parse a comma-separated skills string into a clean array.
 *   - Trims each entry
 *   - Drops empties
 *   - Lower-cases (server compares case-insensitive)
 */
function parseSkillsCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

interface EmployerFilterBarProps {
  value: EmployerFilter;
  onChange: (next: EmployerFilter) => void;
}

export function EmployerFilterBar({ value, onChange }: EmployerFilterBarProps) {
  function update(patch: Partial<EmployerFilter>): void {
    onChange({ ...value, ...patch });
  }

  function toggleIndustry(option: string): void {
    const set = new Set(value.industry);
    if (set.has(option)) set.delete(option);
    else set.add(option);
    update({ industry: Array.from(set) });
  }

  function toggleLevel(option: string): void {
    const set = new Set(value.level);
    if (set.has(option)) set.delete(option);
    else set.add(option);
    update({ level: Array.from(set) });
  }

  function handleSkillsChange(raw: string): void {
    update({ skills: parseSkillsCsv(raw) });
  }

  function handleSalaryMin(raw: string): void {
    if (raw === '') {
      update({ salary_min: null });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) update({ salary_min: n });
  }

  function handleSalaryMax(raw: string): void {
    if (raw === '') {
      update({ salary_max: null });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) update({ salary_max: n });
  }

  function handleReset(): void {
    onChange(EMPTY_FILTER);
  }

  const skillsInputValue = value.skills.join(', ');

  return (
    <aside className="employer-filter-bar" data-testid="employer-filter-bar">
      <header className="employer-filter-bar-header">
        <h2 className="employer-filter-bar-title">筛选</h2>
        <button
          type="button"
          className="employer-filter-reset"
          data-testid="employer-filter-reset"
          onClick={handleReset}
        >
          重置
        </button>
      </header>

      <section className="employer-filter-group" data-testid="employer-filter-industry">
        <h3 className="employer-filter-group-title">行业</h3>
        <div className="employer-filter-chips">
          {INDUSTRY_OPTIONS.map((opt) => {
            const active = value.industry.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                className={`employer-filter-chip${active ? ' active' : ''}`}
                data-testid={`employer-filter-industry-chip-${opt}`}
                aria-pressed={active}
                onClick={() => toggleIndustry(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </section>

      <section className="employer-filter-group" data-testid="employer-filter-level">
        <h3 className="employer-filter-group-title">职级</h3>
        <div className="employer-filter-chips">
          {LEVEL_OPTIONS.map((opt) => {
            const active = value.level.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                className={`employer-filter-chip${active ? ' active' : ''}`}
                data-testid={`employer-filter-level-chip-${opt}`}
                aria-pressed={active}
                onClick={() => toggleLevel(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </section>

      <section className="employer-filter-group" data-testid="employer-filter-skills">
        <h3 className="employer-filter-group-title">技能</h3>
        <input
          type="text"
          className="employer-filter-input"
          data-testid="employer-filter-skills-input"
          placeholder="react, typescript"
          value={skillsInputValue}
          onChange={(e) => handleSkillsChange(e.target.value)}
        />
        <p className="employer-filter-hint">逗号分隔,任意一项命中即可</p>
      </section>

      <section className="employer-filter-group" data-testid="employer-filter-salary">
        <h3 className="employer-filter-group-title">薪资范围</h3>
        <div className="employer-filter-salary-row">
          <input
            type="number"
            min={0}
            className="employer-filter-input"
            data-testid="employer-filter-salary-min"
            placeholder="下限"
            value={value.salary_min ?? ''}
            onChange={(e) => handleSalaryMin(e.target.value)}
          />
          <span className="employer-filter-salary-sep">—</span>
          <input
            type="number"
            min={0}
            className="employer-filter-input"
            data-testid="employer-filter-salary-max"
            placeholder="上限"
            value={value.salary_max ?? ''}
            onChange={(e) => handleSalaryMax(e.target.value)}
          />
        </div>
      </section>
    </aside>
  );
}