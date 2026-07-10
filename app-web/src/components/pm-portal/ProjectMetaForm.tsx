import { useEffect, useMemo, useState } from 'react';

// ============================================================================
// ProjectMetaForm (S8 / Task 15)
// ============================================================================
//
// Controlled form used by CreateProjectModal to collect the "meta" fields
// the PM needs to seed a new project. Six field groups, all optional
// except the project name:
//
//   - name            text      required, 1..200 chars
//   - target          textarea  optional, 0..2000 chars
//   - budget_total    number    optional, non-negative integer (¥; user
//                               input in 元, we send fen-equivalent — the
//                               backend stores cents/fen, see comment in
//                               CreateProjectModal)
//   - start_at        date      optional, ISO date (YYYY-MM-DD)
//   - end_at          date      optional, ISO date; must be ≥ start_at
//                               when both are present
//   - current_team    list      optional, [] to {role, count} slots;
//                               rows can be added / removed at runtime
//
// The form is intentionally a **pure presentation component** — the
// parent owns the data (`value`) and reacts to changes (`onChange`).
// That way the modal can:
//   1. swap the form for a different read-only view in tests
//   2. control the submit phase (validity, error display, disabled state)
// without reaching into form internals.
//
// Validation is local to the form. Validity is surfaced via the
// optional `onValidityChange` callback so the parent can enable /
// disable the submit button without having to re-derive it. Field
// errors are only shown once the user has touched the field
// (blur / change) OR the parent passes `showErrors` (used by the
// modal after a failed submit attempt to surface every issue at once).
//
// We do NOT call the API from here — the parent does that on submit.

export const NAME_MIN = 1;
export const NAME_MAX = 200;
export const TARGET_MAX = 2000;

export interface ProjectTeamMemberDraft {
  /** Local-only stable id so React keys stay stable across reorders. */
  id: string;
  role: string;
  count: number;
}

export interface ProjectMetaFormValue {
  name: string;
  target: string;
  budget_total: number | null;
  /** unix ms */
  start_at: number | null;
  /** unix ms */
  end_at: number | null;
  current_team: ProjectTeamMemberDraft[];
}

export interface ProjectMetaFormErrors {
  name?: string;
  target?: string;
  budget_total?: string;
  start_at?: string;
  end_at?: string;
  current_team?: string;
  teamRole?: string;
  teamCount?: string;
}

export interface ProjectMetaFormProps {
  value: ProjectMetaFormValue;
  onChange: (value: ProjectMetaFormValue) => void;
  /**
   * True when the parent wants every field error visible regardless
   * of touch state. Set this to true after a failed submit attempt.
   */
  showErrors?: boolean;
  /** Tells the parent whether the current value passes validation. */
  onValidityChange?: (isValid: boolean) => void;
  /** Disables every input (used during submit). */
  disabled?: boolean;
  /** Optional test-id prefix override. Defaults to `pm-project-form`. */
  testIdPrefix?: string;
}

// ---- Date helpers ---------------------------------------------------------

/**
 * Convert a unix-ms timestamp to a `<input type="date">` value
 * (YYYY-MM-DD in **local** time). Returns `""` for null so the input
 * is empty rather than "1970-01-01".
 *
 * We use local time (not UTC) so the PM picks the calendar day they
 * mean, regardless of timezone. The displayed date and the round-trip
 * back to ms will use the same Y/M/D, so the value the PM sees is
 * exactly the value we send.
 */
export function msToDateInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert a YYYY-MM-DD string from `<input type="date">` back to a
 * unix-ms timestamp (local midnight). Returns `null` for empty
 * input. We intentionally accept `Date.parse` semantics only as a
 * fallback — the primary path splits the parts explicitly to dodge
 * timezone weirdness.
 */
export function dateInputToMs(s: string): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo - 1, d).getTime();
}

// ---- Validation -----------------------------------------------------------

/**
 * Validate a single form value. Returns a flat errors object; empty
 * object = valid. Pure function — exposed for tests.
 *
 * The rules mirror backend Zod constraints from
 * `src/main/schemas/pm.ts → CreateProjectSchema`, with the additional
 * end_at ≥ start_at cross-field check that the backend doesn't enforce
 * (it's a UX courtesy — the PM shouldn't be allowed to enter a project
 * that ends before it starts).
 */
export function validateProjectMeta(value: ProjectMetaFormValue): ProjectMetaFormErrors {
  const errors: ProjectMetaFormErrors = {};

  const name = value.name.trim();
  if (name.length < NAME_MIN) {
    errors.name = `项目名称为必填,长度 ${NAME_MIN}-${NAME_MAX} 字符`;
  } else if (name.length > NAME_MAX) {
    errors.name = `项目名称最多 ${NAME_MAX} 字符`;
  }

  if (value.target.length > TARGET_MAX) {
    errors.target = `项目目标最多 ${TARGET_MAX} 字符`;
  }

  if (value.budget_total != null) {
    if (!Number.isFinite(value.budget_total) || value.budget_total < 0) {
      errors.budget_total = '预算必须是非负整数';
    } else if (!Number.isInteger(value.budget_total)) {
      errors.budget_total = '预算必须是整数 (元)';
    }
  }

  if (value.start_at != null && value.end_at != null && value.end_at < value.start_at) {
    errors.end_at = '结束日期不能早于开始日期';
  }

  return errors;
}

// ---- Component ------------------------------------------------------------

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="pm-project-form-error" data-testid={id} role="alert">
      {message}
    </p>
  );
}

let _teamSeq = 0;
function nextTeamId(): string {
  // Monotonic + collision-resistant enough for UI use; the id is dropped
  // before submission so its format never reaches the API.
  _teamSeq += 1;
  return `t-${Date.now().toString(36)}-${_teamSeq}`;
}

export function ProjectMetaForm({
  value,
  onChange,
  showErrors = false,
  onValidityChange,
  disabled = false,
  testIdPrefix = 'pm-project-form',
}: ProjectMetaFormProps) {
  const t = (suffix: string) => `${testIdPrefix}-${suffix}`;

  const errors = useMemo(() => validateProjectMeta(value), [value]);
  const isValid = Object.keys(errors).length === 0;

  // Notify parent of validity changes. We avoid infinite loops by
  // stashing the last-emitted value on a ref via a memo side-effect
  // pattern; simpler: just call the callback inside useEffect and let
  // the parent memoize / use the ref to avoid extra work. For now we
  // call it inside useMemo's "side effect" lane by using a useEffect
  // — keep it explicit and small.
  // (Implemented as a useEffect below to keep semantics clean.)

  // Track touched state per field — we keep it as a Set so the form
  // only shows errors the user has had a chance to produce. The parent
  // forces visibility via `showErrors` (post-submit-attempt).
  // We use a Map<string, true> for stability.
  const [touched, setTouched] = useTouchedMap();

  function markTouched(field: keyof ProjectMetaFormValue | 'teamRole' | 'teamCount') {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function shouldShow(field: keyof ProjectMetaFormErrors): boolean {
    if (showErrors) return Boolean(errors[field]);
    return Boolean(touched[field] && errors[field]);
  }

  function updateField<K extends keyof ProjectMetaFormValue>(
    field: K,
    next: ProjectMetaFormValue[K],
  ) {
    onChange({ ...value, [field]: next });
  }

  function addTeamMember() {
    const next: ProjectTeamMemberDraft[] = [
      ...value.current_team,
      { id: nextTeamId(), role: '', count: 1 },
    ];
    updateField('current_team', next);
  }

  function updateTeamMember(id: string, patch: Partial<ProjectTeamMemberDraft>) {
    const next = value.current_team.map((m) => (m.id === id ? { ...m, ...patch } : m));
    updateField('current_team', next);
  }

  function removeTeamMember(id: string) {
    updateField('current_team', value.current_team.filter((m) => m.id !== id));
  }

  // ---- Validity notification ----
  useNotifyValidity(isValid, onValidityChange);

  return (
    <form
      className="pm-project-form"
      data-testid={t('root')}
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      {/* ---- Name ---- */}
      <div className="pm-project-form-field">
        <label htmlFor={t('name')}>
          项目名称 <span className="pm-project-form-required" aria-label="必填">*</span>
        </label>
        <input
          id={t('name')}
          type="text"
          className="pm-input"
          value={value.name}
          maxLength={NAME_MAX}
          disabled={disabled}
          onChange={(e) => updateField('name', e.target.value)}
          onBlur={() => markTouched('name')}
          placeholder="例如:AI 平台招聘 2026 Q4"
          data-testid={t('name')}
          aria-required="true"
          aria-invalid={shouldShow('name')}
        />
        <FieldError id={t('name-error')} message={shouldShow('name') ? errors.name : undefined} />
      </div>

      {/* ---- Target ---- */}
      <div className="pm-project-form-field">
        <label htmlFor={t('target')}>
          项目目标
          <span className="pm-project-form-hint"> (可选,最多 {TARGET_MAX} 字)</span>
        </label>
        <textarea
          id={t('target')}
          className="pm-input pm-project-form-textarea"
          value={value.target}
          maxLength={TARGET_MAX}
          disabled={disabled}
          onChange={(e) => updateField('target', e.target.value)}
          onBlur={() => markTouched('target')}
          placeholder="例如:12 个月内招满 5 名资深后端,2 名产品,搭建 AI 平台基础团队"
          data-testid={t('target')}
          rows={4}
        />
        <FieldError id={t('target-error')} message={shouldShow('target') ? errors.target : undefined} />
      </div>

      {/* ---- Budget ---- */}
      <div className="pm-project-form-field pm-project-form-field-inline">
        <label htmlFor={t('budget')}>
          预算
          <span className="pm-project-form-hint"> (元,可选)</span>
        </label>
        <input
          id={t('budget')}
          type="number"
          className="pm-input"
          value={value.budget_total == null ? '' : String(value.budget_total)}
          min={0}
          step={1}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              updateField('budget_total', null);
            } else {
              const n = Number(raw);
              updateField('budget_total', Number.isFinite(n) ? n : null);
            }
            markTouched('budget_total');
          }}
          onBlur={() => markTouched('budget_total')}
          placeholder="500000"
          data-testid={t('budget')}
          aria-invalid={shouldShow('budget_total')}
        />
        <FieldError id={t('budget-error')} message={shouldShow('budget_total') ? errors.budget_total : undefined} />
      </div>

      {/* ---- Dates ---- */}
      <div className="pm-project-form-row">
        <div className="pm-project-form-field pm-project-form-field-half">
          <label htmlFor={t('start')}>
            开始日期
            <span className="pm-project-form-hint"> (可选)</span>
          </label>
          <input
            id={t('start')}
            type="date"
            className="pm-input"
            value={msToDateInput(value.start_at)}
            disabled={disabled}
            onChange={(e) => {
              updateField('start_at', dateInputToMs(e.target.value));
              markTouched('start_at');
            }}
            onBlur={() => markTouched('start_at')}
            data-testid={t('start')}
            aria-invalid={shouldShow('start_at')}
          />
        </div>
        <div className="pm-project-form-field pm-project-form-field-half">
          <label htmlFor={t('end')}>
            结束日期
            <span className="pm-project-form-hint"> (可选)</span>
          </label>
          <input
            id={t('end')}
            type="date"
            className="pm-input"
            value={msToDateInput(value.end_at)}
            disabled={disabled}
            onChange={(e) => {
              updateField('end_at', dateInputToMs(e.target.value));
              markTouched('end_at');
            }}
            onBlur={() => markTouched('end_at')}
            data-testid={t('end')}
            aria-invalid={shouldShow('end_at')}
            min={msToDateInput(value.start_at) || undefined}
          />
          <FieldError id={t('end-error')} message={shouldShow('end_at') ? errors.end_at : undefined} />
        </div>
      </div>

      {/* ---- Team ---- */}
      <div className="pm-project-form-field">
        <label>团队成员</label>
        {value.current_team.length === 0 && (
          <p className="pm-project-form-hint" data-testid={t('team-empty')}>
            尚未添加成员。可填写「角色 + 人数」,例如:招聘官 × 1、HRBP × 1。
          </p>
        )}
        {value.current_team.length > 0 && (
          <ul className="pm-project-form-team-list" data-testid={t('team-list')}>
            {value.current_team.map((m) => (
              <li
                key={m.id}
                className="pm-project-form-team-row"
                data-testid={t('team-row')}
                data-member-id={m.id}
              >
                <input
                  type="text"
                  className="pm-input pm-project-form-team-role"
                  value={m.role}
                  maxLength={100}
                  placeholder="角色 (例:招聘官)"
                  disabled={disabled}
                  onChange={(e) => updateTeamMember(m.id, { role: e.target.value })}
                  onBlur={() => markTouched('teamRole')}
                  data-testid={t('team-role')}
                  aria-label="角色"
                />
                <input
                  type="number"
                  className="pm-input pm-project-form-team-count"
                  value={m.count}
                  min={0}
                  step={1}
                  disabled={disabled}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    updateTeamMember(m.id, { count: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 });
                    markTouched('teamCount');
                  }}
                  onBlur={() => markTouched('teamCount')}
                  data-testid={t('team-count')}
                  aria-label="人数"
                />
                <button
                  type="button"
                  className="pm-btn-link pm-project-form-team-remove"
                  onClick={() => removeTeamMember(m.id)}
                  disabled={disabled}
                  data-testid={t('team-remove')}
                  aria-label="删除该成员"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="pm-btn-secondary pm-project-form-team-add"
          onClick={addTeamMember}
          disabled={disabled}
          data-testid={t('team-add')}
        >
          + 添加成员
        </button>
      </div>
    </form>
  );
}

// ---- Tiny local hooks (kept inline so the form file is self-contained) ----

type TouchedMap = Partial<Record<keyof ProjectMetaFormValue | 'teamRole' | 'teamCount', boolean>>;

function useTouchedMap(): [TouchedMap, (updater: (prev: TouchedMap) => TouchedMap) => void] {
  const [touched, setTouched] = useState<TouchedMap>({});
  return [touched, setTouched];
}

/**
 * Effect that fires `onValidityChange(isValid)` whenever validity flips.
 * Always fires once on mount so the parent can render the submit button
 * in the right state from the start.
 */
function useNotifyValidity(isValid: boolean, cb?: (v: boolean) => void) {
  useEffect(() => {
    cb?.(isValid);
    // We intentionally don't include `cb` in deps; the parent usually
    // passes a stable function. If it doesn't, the parent should memoise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid]);
}
