import { useEffect, useMemo, useState } from 'react';

// ============================================================================
// JobPostForm (Phase 3c, Task 5)
// ============================================================================
//
// Controlled form used by the Jobs Management page to collect the fields
// needed to create or edit a Job posting. Seven fields:
//
//   - title         text      required, 1..100 chars (trimmed)
//   - description   textarea  optional, 0..2000 chars
//   - industry      select    optional, one of INDUSTRY_OPTIONS
//   - title_level   select    optional, one of TITLE_LEVEL_OPTIONS
//   - salary_min    number    optional, integer ¥ ≥ 0
//   - salary_max    number    optional, integer ¥; must be ≥ salary_min when present
//   - priority      select    optional, 'low' | 'normal' | 'high' | 'urgent'
//   - deadline      date      optional, YYYY-MM-DD, must be ≥ today
//
// The form is a **pure presentation component** — the parent owns the
// data (`value`) and reacts to changes (`onChange`). The modal that
// wraps it owns the submit phase (validity, error display, network
// call, error reporting). That way the form is fully testable in
// isolation (see JobPostForm.test.tsx) and re-usable for both create
// and edit modes.
//
// Validation is local to the form. Validity is surfaced via the
// optional `onValidityChange` callback so the parent can enable /
// disable the submit button without re-deriving it. Field errors are
// only shown once the user has touched the field (blur / change) OR
// the parent passes `showErrors` (used after a failed submit attempt
// to surface every issue at once).
//
// We do NOT call the API from here — the parent does that on submit.

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 2000;

export const INDUSTRY_OPTIONS = [
  '互联网',
  '金融',
  '教育',
  '医疗',
  '制造',
  '消费',
  '其他',
] as const;

export const TITLE_LEVEL_OPTIONS = ['junior', 'mid', 'senior', 'staff'] as const;

export const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent'] as const;

export type Industry = (typeof INDUSTRY_OPTIONS)[number];
export type TitleLevel = (typeof TITLE_LEVEL_OPTIONS)[number];
export type Priority = (typeof PRIORITY_OPTIONS)[number];

export interface JobPostFormValue {
  /** Trimmed title. */
  title: string;
  description: string;
  industry: Industry | null;
  title_level: TitleLevel | null;
  /** Integer ¥ (yuan). null when not set. */
  salary_min: number | null;
  /** Integer ¥ (yuan). null when not set. Must be ≥ salary_min when present. */
  salary_max: number | null;
  priority: Priority | null;
  /** YYYY-MM-DD, or null when not set. */
  deadline: string | null;
}

export const EMPTY_JOB_VALUE: JobPostFormValue = {
  title: '',
  description: '',
  industry: null,
  title_level: null,
  salary_min: null,
  salary_max: null,
  priority: null,
  deadline: null,
};

export interface JobPostFormErrors {
  title?: string;
  description?: string;
  industry?: string;
  title_level?: string;
  salary_min?: string;
  salary_max?: string;
  priority?: string;
  deadline?: string;
}

export interface JobPostFormProps {
  value: JobPostFormValue;
  onChange: (value: JobPostFormValue) => void;
  showErrors?: boolean;
  /** Tells the parent whether the current value passes validation. */
  onValidityChange?: (isValid: boolean) => void;
  /** Disables every input (used during submit). */
  disabled?: boolean;
  /** Optional test-id prefix override. Defaults to `employer-job-form`. */
  testIdPrefix?: string;
}

// ---- Validation -----------------------------------------------------------

/**
 * Pure validation. Mirrors backend CreateJobSchema constraints
 * (`src/main/routes/employer.ts`) with the cross-field UX checks the
 * backend doesn't enforce (salary_max ≥ salary_min, deadline ≥ today).
 */
export function validateJobPostForm(value: JobPostFormValue): JobPostFormErrors {
  const errors: JobPostFormErrors = {};

  const title = value.title.trim();
  if (title.length < 1) {
    errors.title = `标题为必填,长度 1-${TITLE_MAX} 字符`;
  } else if (title.length > TITLE_MAX) {
    errors.title = `标题最多 ${TITLE_MAX} 字符`;
  }

  if (value.description.length > DESCRIPTION_MAX) {
    errors.description = `职位描述最多 ${DESCRIPTION_MAX} 字符`;
  }

  if (value.salary_min != null) {
    if (!Number.isFinite(value.salary_min) || value.salary_min < 0) {
      errors.salary_min = '薪资必须是非负整数';
    } else if (!Number.isInteger(value.salary_min)) {
      errors.salary_min = '薪资必须是整数 (元)';
    }
  }

  if (value.salary_max != null) {
    if (!Number.isFinite(value.salary_max) || value.salary_max < 0) {
      errors.salary_max = '薪资必须是非负整数';
    } else if (!Number.isInteger(value.salary_max)) {
      errors.salary_max = '薪资必须是整数 (元)';
    } else if (value.salary_min != null && value.salary_max < value.salary_min) {
      errors.salary_max = '最高薪资不能小于最低薪资';
    }
  }

  if (value.industry != null && !INDUSTRY_OPTIONS.includes(value.industry)) {
    errors.industry = '行业选项无效';
  }

  if (value.title_level != null && !TITLE_LEVEL_OPTIONS.includes(value.title_level)) {
    errors.title_level = '职级选项无效';
  }

  if (value.priority != null && !PRIORITY_OPTIONS.includes(value.priority)) {
    errors.priority = '优先级选项无效';
  }

  if (value.deadline != null && value.deadline !== '') {
    // Cross-field: deadline must not be in the past.
    // Compute today's local midnight so the comparison is calendar-day
    // based (matches the calendar-picker semantics).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.deadline);
    if (!m) {
      errors.deadline = '截止日期格式无效';
    } else {
      const today = new Date();
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const input = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      if (input < todayMidnight) {
        errors.deadline = '截止日期不能早于今天';
      }
    }
  }

  return errors;
}

// ---- Component ------------------------------------------------------------

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="employer-job-form-error" data-testid={id} role="alert">
      {message}
    </p>
  );
}

/**
 * Wrap a number input change handler so:
 *   - empty string -> null
 *   - negative -> 0 (defensive — the input is min=0 but a paste can sneak in)
 *   - non-numeric -> null
 *   - fractional -> Math.round(x) to keep the integer invariant
 */
function readNumberInput(raw: string): number | null {
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  return Math.round(n);
}

export function JobPostForm({
  value,
  onChange,
  showErrors = false,
  onValidityChange,
  disabled = false,
  testIdPrefix = 'employer-job-form',
}: JobPostFormProps) {
  const t = (suffix: string) => `${testIdPrefix}-${suffix}`;

  const errors = useMemo(() => validateJobPostForm(value), [value]);
  const isValid = Object.keys(errors).length === 0;

  const [touched, setTouched] = useState<
    Partial<Record<keyof JobPostFormValue, boolean>>
  >({});

  function markTouched(field: keyof JobPostFormValue) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function shouldShow(field: keyof JobPostFormErrors): boolean {
    if (showErrors) return Boolean(errors[field]);
    return Boolean(touched[field] && errors[field]);
  }

  function updateField<K extends keyof JobPostFormValue>(
    field: K,
    next: JobPostFormValue[K],
  ) {
    onChange({ ...value, [field]: next });
  }

  // Validity notification — fires on mount and whenever validity flips.
  useEffect(() => {
    onValidityChange?.(isValid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid]);

  return (
    <form
      className="employer-job-form"
      data-testid={t('root')}
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      {/* ---- Title ---- */}
      <div className="employer-job-form-field">
        <label htmlFor={t('title')}>
          标题 <span className="employer-job-form-required" aria-label="必填">*</span>
        </label>
        <input
          id={t('title')}
          type="text"
          className="employer-job-form-input"
          value={value.title}
          maxLength={TITLE_MAX}
          disabled={disabled}
          onChange={(e) => updateField('title', e.target.value)}
          onBlur={() => markTouched('title')}
          placeholder="例如:高级后端工程师"
          data-testid={t('title')}
          aria-required="true"
          aria-invalid={shouldShow('title')}
        />
        <FieldError id={t('title-error')} message={shouldShow('title') ? errors.title : undefined} />
      </div>

      {/* ---- Description ---- */}
      <div className="employer-job-form-field">
        <label htmlFor={t('description')}>
          描述
          <span className="employer-job-form-hint"> (可选,最多 {DESCRIPTION_MAX} 字)</span>
        </label>
        <textarea
          id={t('description')}
          className="employer-job-form-input employer-job-form-textarea"
          value={value.description}
          maxLength={DESCRIPTION_MAX}
          disabled={disabled}
          onChange={(e) => updateField('description', e.target.value)}
          onBlur={() => markTouched('description')}
          placeholder="职位描述、职责、任职要求等"
          data-testid={t('description')}
          rows={4}
        />
        <FieldError
          id={t('description-error')}
          message={shouldShow('description') ? errors.description : undefined}
        />
      </div>

      {/* ---- Industry ---- */}
      <div className="employer-job-form-field">
        <label htmlFor={t('industry')}>
          行业
          <span className="employer-job-form-hint"> (可选)</span>
        </label>
        <select
          id={t('industry')}
          className="employer-job-form-input"
          value={value.industry ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            updateField('industry', v === '' ? null : (v as Industry));
            markTouched('industry');
          }}
          onBlur={() => markTouched('industry')}
          data-testid={t('industry')}
        >
          <option value="">未选择</option>
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <FieldError
          id={t('industry-error')}
          message={shouldShow('industry') ? errors.industry : undefined}
        />
      </div>

      {/* ---- Title Level ---- */}
      <div className="employer-job-form-field">
        <label htmlFor={t('title-level')}>
          职级
          <span className="employer-job-form-hint"> (可选)</span>
        </label>
        <select
          id={t('title-level')}
          className="employer-job-form-input"
          value={value.title_level ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            updateField('title_level', v === '' ? null : (v as TitleLevel));
            markTouched('title_level');
          }}
          onBlur={() => markTouched('title_level')}
          data-testid={t('title-level')}
        >
          <option value="">未选择</option>
          {TITLE_LEVEL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <FieldError
          id={t('title-level-error')}
          message={shouldShow('title_level') ? errors.title_level : undefined}
        />
      </div>

      {/* ---- Salary range ---- */}
      <div className="employer-job-form-row">
        <div className="employer-job-form-field employer-job-form-field-half">
          <label htmlFor={t('salary-min')}>
            薪资下限
            <span className="employer-job-form-hint"> (元,可选)</span>
          </label>
          <input
            id={t('salary-min')}
            type="number"
            className="employer-job-form-input"
            value={value.salary_min == null ? '' : String(value.salary_min)}
            min={0}
            step={1}
            disabled={disabled}
            onChange={(e) => {
              updateField('salary_min', readNumberInput(e.target.value));
              markTouched('salary_min');
            }}
            onBlur={() => markTouched('salary_min')}
            placeholder="50000"
            data-testid={t('salary-min')}
            aria-invalid={shouldShow('salary_min')}
          />
          <FieldError
            id={t('salary-min-error')}
            message={shouldShow('salary_min') ? errors.salary_min : undefined}
          />
        </div>
        <div className="employer-job-form-field employer-job-form-field-half">
          <label htmlFor={t('salary-max')}>
            薪资上限
            <span className="employer-job-form-hint"> (元,可选)</span>
          </label>
          <input
            id={t('salary-max')}
            type="number"
            className="employer-job-form-input"
            value={value.salary_max == null ? '' : String(value.salary_max)}
            min={0}
            step={1}
            disabled={disabled}
            onChange={(e) => {
              updateField('salary_max', readNumberInput(e.target.value));
              markTouched('salary_max');
            }}
            onBlur={() => markTouched('salary_max')}
            placeholder="80000"
            data-testid={t('salary-max')}
            aria-invalid={shouldShow('salary_max')}
          />
          <FieldError
            id={t('salary-max-error')}
            message={shouldShow('salary_max') ? errors.salary_max : undefined}
          />
        </div>
      </div>

      {/* ---- Priority ---- */}
      <div className="employer-job-form-field">
        <label htmlFor={t('priority')}>
          优先级
          <span className="employer-job-form-hint"> (可选)</span>
        </label>
        <select
          id={t('priority')}
          className="employer-job-form-input"
          value={value.priority ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            updateField('priority', v === '' ? null : (v as Priority));
            markTouched('priority');
          }}
          onBlur={() => markTouched('priority')}
          data-testid={t('priority')}
        >
          <option value="">未选择</option>
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <FieldError
          id={t('priority-error')}
          message={shouldShow('priority') ? errors.priority : undefined}
        />
      </div>

      {/* ---- Deadline ---- */}
      <div className="employer-job-form-field">
        <label htmlFor={t('deadline')}>
          截止日期
          <span className="employer-job-form-hint"> (可选)</span>
        </label>
        <input
          id={t('deadline')}
          type="date"
          className="employer-job-form-input"
          value={value.deadline ?? ''}
          disabled={disabled}
          onChange={(e) => {
            updateField('deadline', e.target.value === '' ? null : e.target.value);
            markTouched('deadline');
          }}
          onBlur={() => markTouched('deadline')}
          data-testid={t('deadline')}
          aria-invalid={shouldShow('deadline')}
        />
        <FieldError
          id={t('deadline-error')}
          message={shouldShow('deadline') ? errors.deadline : undefined}
        />
      </div>
    </form>
  );
}
