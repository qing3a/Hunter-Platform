import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  JobPostForm,
  validateJobPostForm,
  EMPTY_JOB_VALUE,
  TITLE_MAX,
  DESCRIPTION_MAX,
  INDUSTRY_OPTIONS,
  TITLE_LEVEL_OPTIONS,
  PRIORITY_OPTIONS,
  type JobPostFormValue,
} from '../JobPostForm';

// ---- Helpers --------------------------------------------------------------

function makeValue(overrides: Partial<JobPostFormValue> = {}): JobPostFormValue {
  return { ...EMPTY_JOB_VALUE, ...overrides };
}

function renderForm(opts: {
  value?: JobPostFormValue;
  onChange?: (v: JobPostFormValue) => void;
  showErrors?: boolean;
  onValidityChange?: (v: boolean) => void;
  disabled?: boolean;
  testIdPrefix?: string;
} = {}) {
  const onChange = opts.onChange ?? vi.fn();
  const onValidityChange = opts.onValidityChange ?? vi.fn();
  const value = opts.value ?? makeValue();
  const utils = render(
    <JobPostForm
      value={value}
      onChange={onChange}
      showErrors={opts.showErrors}
      onValidityChange={onValidityChange}
      disabled={opts.disabled}
      testIdPrefix={opts.testIdPrefix}
    />,
  );
  return { onChange, onValidityChange, value, ...utils };
}

function StatefulForm(props: {
  initial?: JobPostFormValue;
  showErrors?: boolean;
  onValidityChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<JobPostFormValue>(props.initial ?? makeValue());
  return (
    <JobPostForm
      value={value}
      onChange={setValue}
      showErrors={props.showErrors}
      onValidityChange={props.onValidityChange}
      disabled={props.disabled}
    />
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---- Pure-function tests --------------------------------------------------

describe('validateJobPostForm', () => {
  it('rejects an empty title with a length-bound message', () => {
    const errs = validateJobPostForm(makeValue({ title: '' }));
    expect(errs.title).toMatch(/标题为必填/);
  });

  it('rejects a whitespace-only title (trimmed length is 0)', () => {
    const errs = validateJobPostForm(makeValue({ title: '   ' }));
    expect(errs.title).toBeDefined();
  });

  it('accepts a 1-char title (lower bound)', () => {
    const errs = validateJobPostForm(makeValue({ title: 'A' }));
    expect(errs.title).toBeUndefined();
  });

  it('accepts a title at the 100-char limit', () => {
    const errs = validateJobPostForm(makeValue({ title: 'A'.repeat(TITLE_MAX) }));
    expect(errs.title).toBeUndefined();
  });

  it('rejects a title longer than 100 chars', () => {
    const errs = validateJobPostForm(makeValue({ title: 'A'.repeat(TITLE_MAX + 1) }));
    expect(errs.title).toMatch(/最多 100/);
  });

  it('accepts an empty description (optional)', () => {
    const errs = validateJobPostForm(makeValue({ title: 'ok', description: '' }));
    expect(errs.description).toBeUndefined();
  });

  it('accepts a description up to 2000 chars', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', description: 'x'.repeat(DESCRIPTION_MAX) }),
    );
    expect(errs.description).toBeUndefined();
  });

  it('rejects a description over 2000 chars', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', description: 'x'.repeat(DESCRIPTION_MAX + 1) }),
    );
    expect(errs.description).toMatch(/最多 2000/);
  });

  it('rejects a negative salary_min', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', salary_min: -1, salary_max: null }),
    );
    expect(errs.salary_min).toBeDefined();
  });

  it('rejects a non-integer salary_min', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', salary_min: 1.5, salary_max: null }),
    );
    expect(errs.salary_min).toMatch(/整数/);
  });

  it('rejects salary_max < salary_min (cross-field check)', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', salary_min: 100, salary_max: 50 }),
    );
    expect(errs.salary_max).toMatch(/不能小于/);
  });

  it('accepts salary_max === salary_min (same band is fine)', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', salary_min: 100, salary_max: 100 }),
    );
    expect(errs.salary_max).toBeUndefined();
  });

  it('accepts salary_min present but salary_max absent', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', salary_min: 100, salary_max: null }),
    );
    expect(errs.salary_min).toBeUndefined();
    expect(errs.salary_max).toBeUndefined();
  });

  it('accepts salary_max present but salary_min absent', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', salary_min: null, salary_max: 100 }),
    );
    expect(errs.salary_min).toBeUndefined();
    expect(errs.salary_max).toBeUndefined();
  });

  it('accepts known industry options', () => {
    for (const ind of INDUSTRY_OPTIONS) {
      const errs = validateJobPostForm(makeValue({ title: 'ok', industry: ind }));
      expect(errs.industry).toBeUndefined();
    }
  });

  it('rejects an unknown industry', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', industry: 'petroleum' as unknown as JobPostFormValue['industry'] }),
    );
    expect(errs.industry).toBeDefined();
  });

  it('accepts known title_level options', () => {
    for (const tl of TITLE_LEVEL_OPTIONS) {
      const errs = validateJobPostForm(makeValue({ title: 'ok', title_level: tl }));
      expect(errs.title_level).toBeUndefined();
    }
  });

  it('accepts known priority options', () => {
    for (const p of PRIORITY_OPTIONS) {
      const errs = validateJobPostForm(makeValue({ title: 'ok', priority: p }));
      expect(errs.priority).toBeUndefined();
    }
  });

  it('flags a deadline in the past (cross-field check vs today)', () => {
    // Build a YYYY-MM-DD that's clearly in the past (year 2000).
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', deadline: '2000-01-01' }),
    );
    expect(errs.deadline).toMatch(/不能早于/);
  });

  it('accepts a future deadline', () => {
    const errs = validateJobPostForm(
      makeValue({ title: 'ok', deadline: '2099-12-31' }),
    );
    expect(errs.deadline).toBeUndefined();
  });

  it('accepts an empty (null) deadline (optional)', () => {
    const errs = validateJobPostForm(makeValue({ title: 'ok', deadline: null }));
    expect(errs.deadline).toBeUndefined();
  });
});

// ---- Component tests ------------------------------------------------------

describe('JobPostForm', () => {
  it('renders every field with the expected testids', () => {
    renderForm();
    expect(screen.getByTestId('employer-job-form-root')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-title')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-description')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-industry')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-title-level')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-salary-min')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-salary-max')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-priority')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-deadline')).toBeInTheDocument();
  });

  it('hydrates inputs from the value prop (controlled)', () => {
    renderForm({
      value: makeValue({
        title: 'Senior Backend Engineer',
        description: 'Some details',
        industry: '互联网',
        title_level: 'senior',
        salary_min: 50000,
        salary_max: 80000,
        priority: 'high',
        deadline: '2026-12-31',
      }),
    });
    expect((screen.getByTestId('employer-job-form-title') as HTMLInputElement).value).toBe(
      'Senior Backend Engineer',
    );
    expect(
      (screen.getByTestId('employer-job-form-description') as HTMLTextAreaElement).value,
    ).toBe('Some details');
    expect(
      (screen.getByTestId('employer-job-form-salary-min') as HTMLInputElement).value,
    ).toBe('50000');
    expect(
      (screen.getByTestId('employer-job-form-salary-max') as HTMLInputElement).value,
    ).toBe('80000');
    expect((screen.getByTestId('employer-job-form-deadline') as HTMLInputElement).value).toBe(
      '2026-12-31',
    );
  });

  it('emits a new value on title change', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('employer-job-form-title'), {
      target: { value: 'New title' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'New title' }),
    );
  });

  it('emits a new value on description change', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('employer-job-form-description'), {
      target: { value: 'Some details' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: 'Some details' }),
    );
  });

  it('converts a salary input to a number', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('employer-job-form-salary-min'), {
      target: { value: '12345' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ salary_min: 12345 }),
    );
  });

  it('treats an empty salary input as null', () => {
    const { onChange } = renderForm({ value: makeValue({ salary_min: 5000 }) });
    fireEvent.change(screen.getByTestId('employer-job-form-salary-min'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ salary_min: null }),
    );
  });

  it('does NOT show field errors until the field is touched', () => {
    renderForm({ value: makeValue({ title: '' }) });
    expect(screen.queryByTestId('employer-job-form-title-error')).toBeNull();
    fireEvent.blur(screen.getByTestId('employer-job-form-title'));
    expect(screen.getByTestId('employer-job-form-title-error')).toBeInTheDocument();
  });

  it('shows every field error when showErrors=true (parent-forced)', () => {
    renderForm({
      value: makeValue({
        title: '',
        description: 'x'.repeat(DESCRIPTION_MAX + 1),
        salary_min: 100,
        salary_max: 50,
      }),
      showErrors: true,
    });
    expect(screen.getByTestId('employer-job-form-title-error')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-description-error')).toBeInTheDocument();
    expect(screen.getByTestId('employer-job-form-salary-max-error')).toBeInTheDocument();
  });

  it('fires onValidityChange(true) for a valid initial value', () => {
    const onValidityChange = vi.fn();
    renderForm({ value: makeValue({ title: 'OK' }), onValidityChange });
    expect(onValidityChange).toHaveBeenCalledWith(true);
  });

  it('fires onValidityChange(false) when the title becomes empty', () => {
    const onValidityChange = vi.fn();
    const { rerender } = render(
      <JobPostForm
        value={makeValue({ title: 'OK' })}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    rerender(
      <JobPostForm
        value={makeValue({ title: '' })}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it('disables all inputs when disabled=true', () => {
    renderForm({ disabled: true });
    expect((screen.getByTestId('employer-job-form-title') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByTestId('employer-job-form-description') as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('employer-job-form-salary-min') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('employer-job-form-deadline') as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('renders industry options including "互联网 / 金融 / 教育 / 医疗 / 制造 / 消费 / 其他"', () => {
    renderForm();
    const industrySelect = screen.getByTestId('employer-job-form-industry') as HTMLSelectElement;
    const optionLabels = Array.from(industrySelect.options).map((o) => o.text);
    expect(optionLabels).toContain('互联网');
    expect(optionLabels).toContain('金融');
    expect(optionLabels).toContain('教育');
    expect(optionLabels).toContain('医疗');
    expect(optionLabels).toContain('制造');
    expect(optionLabels).toContain('消费');
    expect(optionLabels).toContain('其他');
  });

  it('renders title_level options including "junior / mid / senior / staff"', () => {
    renderForm();
    const select = screen.getByTestId('employer-job-form-title-level') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.text);
    expect(optionLabels).toContain('junior');
    expect(optionLabels).toContain('mid');
    expect(optionLabels).toContain('senior');
    expect(optionLabels).toContain('staff');
  });

  it('renders priority options including "low / normal / high / urgent"', () => {
    renderForm();
    const select = screen.getByTestId('employer-job-form-priority') as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.text);
    expect(optionLabels).toContain('low');
    expect(optionLabels).toContain('normal');
    expect(optionLabels).toContain('high');
    expect(optionLabels).toContain('urgent');
  });

  it('honors the testIdPrefix prop', () => {
    renderForm({ testIdPrefix: 'custom-prefix' });
    expect(screen.getByTestId('custom-prefix-root')).toBeInTheDocument();
    expect(screen.getByTestId('custom-prefix-title')).toBeInTheDocument();
  });

  // ---- Stateful interaction ----

  it('updates the salary inputs reactively (round-trip via stateful wrapper)', () => {
    render(<StatefulForm initial={makeValue({ title: 'ok' })} />);
    fireEvent.change(screen.getByTestId('employer-job-form-salary-min'), {
      target: { value: '50000' },
    });
    fireEvent.change(screen.getByTestId('employer-job-form-salary-max'), {
      target: { value: '80000' },
    });
    expect(
      (screen.getByTestId('employer-job-form-salary-min') as HTMLInputElement).value,
    ).toBe('50000');
    expect(
      (screen.getByTestId('employer-job-form-salary-max') as HTMLInputElement).value,
    ).toBe('80000');
  });

  it('clamps negative salary to 0 in the input value', () => {
    render(<StatefulForm initial={makeValue({ title: 'ok' })} />);
    fireEvent.change(screen.getByTestId('employer-job-form-salary-min'), {
      target: { value: '-100' },
    });
    // Negative -> 0 in the controlled input value.
    expect(
      (screen.getByTestId('employer-job-form-salary-min') as HTMLInputElement).value,
    ).toBe('0');
  });

  it('renders a non-empty placeholder for the industry select', () => {
    renderForm();
    const industrySelect = screen.getByTestId('employer-job-form-industry') as HTMLSelectElement;
    // Default unselected option has an empty value, so the form starts
    // with industry=null until the employer picks one.
    expect(industrySelect.value).toBe('');
  });
});
