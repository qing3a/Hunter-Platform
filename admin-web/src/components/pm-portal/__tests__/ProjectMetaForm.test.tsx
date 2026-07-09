import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import {
  ProjectMetaForm,
  validateProjectMeta,
  msToDateInput,
  dateInputToMs,
  NAME_MAX,
  TARGET_MAX,
  type ProjectMetaFormValue,
} from '../ProjectMetaForm';

// ---- Helpers --------------------------------------------------------------

function makeValue(overrides: Partial<ProjectMetaFormValue> = {}): ProjectMetaFormValue {
  return {
    name: '',
    target: '',
    budget_total: null,
    start_at: null,
    end_at: null,
    current_team: [],
    ...overrides,
  };
}

function renderForm(opts: {
  value?: ProjectMetaFormValue;
  onChange?: (v: ProjectMetaFormValue) => void;
  showErrors?: boolean;
  onValidityChange?: (v: boolean) => void;
  disabled?: boolean;
} = {}) {
  const onChange = opts.onChange ?? vi.fn();
  const onValidityChange = opts.onValidityChange ?? vi.fn();
  const value = opts.value ?? makeValue();
  const utils = render(
    <ProjectMetaForm
      value={value}
      onChange={onChange}
      showErrors={opts.showErrors}
      onValidityChange={onValidityChange}
      disabled={opts.disabled}
    />,
  );
  return { onChange, onValidityChange, value, ...utils };
}

/**
 * Stateful wrapper used by tests that exercise user interactions whose
 * result depends on subsequent re-renders (e.g. add / remove / edit
 * a team member). The form is controlled, so a no-op `onChange` mock
 * would leave the form's `value` prop stale and the DOM would not
 * reflect the user input.
 */
function StatefulForm(props: {
  initial?: ProjectMetaFormValue;
  showErrors?: boolean;
  onValidityChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<ProjectMetaFormValue>(props.initial ?? makeValue());
  return (
    <ProjectMetaForm
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

// ---- Pure-function tests (validators + date helpers) ---------------------

describe('validateProjectMeta', () => {
  it('rejects an empty name with a length-bound message', () => {
    const errs = validateProjectMeta(makeValue({ name: '' }));
    expect(errs.name).toMatch(/项目名称为必填/);
  });

  it('rejects a whitespace-only name (trimmed length is 0)', () => {
    const errs = validateProjectMeta(makeValue({ name: '   ' }));
    expect(errs.name).toBeDefined();
  });

  it('accepts a 1-char name (lower bound)', () => {
    const errs = validateProjectMeta(makeValue({ name: 'A' }));
    expect(errs.name).toBeUndefined();
  });

  it('accepts a name at the 200-char limit', () => {
    const errs = validateProjectMeta(makeValue({ name: 'A'.repeat(NAME_MAX) }));
    expect(errs.name).toBeUndefined();
  });

  it('rejects a name longer than 200 chars', () => {
    const errs = validateProjectMeta(makeValue({ name: 'A'.repeat(NAME_MAX + 1) }));
    expect(errs.name).toMatch(/最多 200/);
  });

  it('rejects a target over 2000 chars', () => {
    const errs = validateProjectMeta(makeValue({ name: 'ok', target: 'x'.repeat(TARGET_MAX + 1) }));
    expect(errs.target).toMatch(/最多 2000/);
  });

  it('rejects a negative budget', () => {
    const errs = validateProjectMeta(makeValue({ name: 'ok', budget_total: -1 }));
    expect(errs.budget_total).toBeDefined();
  });

  it('rejects a fractional budget', () => {
    const errs = validateProjectMeta(makeValue({ name: 'ok', budget_total: 1.5 }));
    expect(errs.budget_total).toMatch(/整数/);
  });

  it('accepts a zero budget (≥0 inclusive)', () => {
    const errs = validateProjectMeta(makeValue({ name: 'ok', budget_total: 0 }));
    expect(errs.budget_total).toBeUndefined();
  });

  it('flags end_at < start_at as invalid (cross-field check)', () => {
    const start = new Date(2026, 5, 10).getTime();   // 2026-06-10
    const end = new Date(2026, 5, 1).getTime();     // 2026-06-01
    const errs = validateProjectMeta(makeValue({ name: 'ok', start_at: start, end_at: end }));
    expect(errs.end_at).toMatch(/结束日期不能早于/);
  });

  it('accepts end_at === start_at (same day is fine)', () => {
    const ms = new Date(2026, 5, 10).getTime();
    const errs = validateProjectMeta(makeValue({ name: 'ok', start_at: ms, end_at: ms }));
    expect(errs.end_at).toBeUndefined();
  });
});

describe('date helpers', () => {
  it('msToDateInput renders an empty string for null', () => {
    expect(msToDateInput(null)).toBe('');
  });

  it('msToDateInput renders YYYY-MM-DD in local time', () => {
    // 2026-06-10 local midnight.
    const ms = new Date(2026, 5, 10).getTime();
    expect(msToDateInput(ms)).toBe('2026-06-10');
  });

  it('dateInputToMs returns null for empty input', () => {
    expect(dateInputToMs('')).toBeNull();
  });

  it('dateInputToMs returns null for malformed input', () => {
    expect(dateInputToMs('not-a-date')).toBeNull();
    expect(dateInputToMs('2026/06/10')).toBeNull();
  });

  it('dateInputToMs round-trips back to the same local midnight', () => {
    const original = new Date(2026, 5, 10).getTime();
    const round = dateInputToMs(msToDateInput(original));
    expect(round).toBe(original);
  });
});

// ---- Component tests ------------------------------------------------------

describe('ProjectMetaForm', () => {
  it('renders every field with the expected testids', () => {
    renderForm();
    expect(screen.getByTestId('pm-project-form-root')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-name')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-target')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-budget')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-start')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-end')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-team-add')).toBeInTheDocument();
  });

  it('shows the empty-state hint when the team list is empty', () => {
    renderForm();
    expect(screen.getByTestId('pm-project-form-team-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-project-form-team-list')).toBeNull();
  });

  it('hydrates inputs from the value prop (controlled)', () => {
    const start = new Date(2026, 5, 10).getTime();
    const end = new Date(2026, 6, 10).getTime();
    renderForm({
      value: makeValue({
        name: 'Hydrated',
        target: 'Hydrated target',
        budget_total: 5000,
        start_at: start,
        end_at: end,
      }),
    });
    expect((screen.getByTestId('pm-project-form-name') as HTMLInputElement).value).toBe('Hydrated');
    expect((screen.getByTestId('pm-project-form-target') as HTMLTextAreaElement).value).toBe(
      'Hydrated target',
    );
    expect((screen.getByTestId('pm-project-form-budget') as HTMLInputElement).value).toBe('5000');
    expect((screen.getByTestId('pm-project-form-start') as HTMLInputElement).value).toBe(
      '2026-06-10',
    );
    expect((screen.getByTestId('pm-project-form-end') as HTMLInputElement).value).toBe(
      '2026-07-10',
    );
  });

  it('emits a new value on every input change (name)', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('pm-project-form-name'), {
      target: { value: 'New name' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'New name' }),
    );
  });

  it('emits a new value on textarea change (target)', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('pm-project-form-target'), {
      target: { value: 'some target' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: 'some target' }),
    );
  });

  it('converts the budget input to a number', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('pm-project-form-budget'), {
      target: { value: '12345' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ budget_total: 12345 }),
    );
  });

  it('treats an empty budget as null', () => {
    const { onChange } = renderForm({ value: makeValue({ budget_total: 5000 }) });
    fireEvent.change(screen.getByTestId('pm-project-form-budget'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ budget_total: null }),
    );
  });

  it('converts a date input string to unix ms', () => {
    const { onChange } = renderForm();
    fireEvent.change(screen.getByTestId('pm-project-form-start'), {
      target: { value: '2026-06-10' },
    });
    const expected = new Date(2026, 5, 10).getTime();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ start_at: expected }),
    );
  });

  it('treats an empty date input as null', () => {
    const { onChange } = renderForm({
      value: makeValue({ start_at: new Date(2026, 5, 10).getTime() }),
    });
    fireEvent.change(screen.getByTestId('pm-project-form-start'), {
      target: { value: '' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ start_at: null }),
    );
  });

  it('does NOT show field errors until the field is touched', () => {
    renderForm({ value: makeValue({ name: '' }) });
    // No errors visible until user touches the name input.
    expect(screen.queryByTestId('pm-project-form-name-error')).toBeNull();
    fireEvent.blur(screen.getByTestId('pm-project-form-name'));
    expect(screen.getByTestId('pm-project-form-name-error')).toBeInTheDocument();
  });

  it('shows every field error when showErrors=true (parent-forced)', () => {
    renderForm({
      value: makeValue({
        name: '',
        start_at: new Date(2026, 5, 10).getTime(),
        end_at: new Date(2026, 4, 1).getTime(),
      }),
      showErrors: true,
    });
    expect(screen.getByTestId('pm-project-form-name-error')).toBeInTheDocument();
    expect(screen.getByTestId('pm-project-form-end-error')).toBeInTheDocument();
  });

  it('fires onValidityChange(true) for a valid initial value', () => {
    const onValidityChange = vi.fn();
    renderForm({ value: makeValue({ name: 'OK' }), onValidityChange });
    // Fires on mount.
    expect(onValidityChange).toHaveBeenCalledWith(true);
  });

  it('fires onValidityChange(false) when the name becomes empty', () => {
    const onValidityChange = vi.fn();
    const { rerender } = render(
      <ProjectMetaForm
        value={makeValue({ name: 'OK' })}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ProjectMetaForm
        value={makeValue({ name: '' })}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it('disables all inputs when disabled=true', () => {
    renderForm({ disabled: true });
    expect((screen.getByTestId('pm-project-form-name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pm-project-form-target') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId('pm-project-form-budget') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pm-project-form-start') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pm-project-form-end') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('pm-project-form-team-add') as HTMLButtonElement).disabled).toBe(true);
  });

  // ---- Team list ----

  it('adds a team member when the "+ 添加成员" button is clicked', () => {
    render(<StatefulForm />);
    fireEvent.click(screen.getByTestId('pm-project-form-team-add'));
    // Stateful wrapper: the new row is rendered after the value update.
    expect(screen.getByTestId('pm-project-form-team-list')).toBeInTheDocument();
    const row = screen.getByTestId('pm-project-form-team-row');
    expect(within(row).getByTestId('pm-project-form-team-role')).toBeInTheDocument();
    expect(within(row).getByTestId('pm-project-form-team-count')).toBeInTheDocument();
  });

  it('updates the role and count of a team member', () => {
    const memberId = 'fixed-id-1';
    render(
      <StatefulForm
        initial={makeValue({
          current_team: [{ id: memberId, role: '', count: 1 }],
        })}
      />,
    );
    const row = screen.getByTestId('pm-project-form-team-row');
    fireEvent.change(within(row).getByTestId('pm-project-form-team-role'), {
      target: { value: '招聘官' },
    });
    fireEvent.change(within(row).getByTestId('pm-project-form-team-count'), {
      target: { value: '3' },
    });
    // Re-query the row after the re-render and verify the inputs hold
    // the new values (the role field should still be 招聘官).
    const updatedRow = screen.getByTestId('pm-project-form-team-row');
    expect(
      (within(updatedRow).getByTestId('pm-project-form-team-role') as HTMLInputElement).value,
    ).toBe('招聘官');
    expect(
      (within(updatedRow).getByTestId('pm-project-form-team-count') as HTMLInputElement).value,
    ).toBe('3');
  });

  it('removes a team member when the per-row delete button is clicked', () => {
    render(
      <StatefulForm
        initial={makeValue({
          current_team: [
            { id: 'a', role: '招聘官', count: 1 },
            { id: 'b', role: 'HRBP', count: 1 },
          ],
        })}
      />,
    );
    const rows = screen.getAllByTestId('pm-project-form-team-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[0]).getByTestId('pm-project-form-team-remove'));
    const remaining = screen.getAllByTestId('pm-project-form-team-row');
    expect(remaining).toHaveLength(1);
    // The remaining row should be the HRBP one (id 'b').
    expect(remaining[0].getAttribute('data-member-id')).toBe('b');
  });

  it('clamps a negative team count to 0 (defensive)', () => {
    render(
      <StatefulForm
        initial={makeValue({
          current_team: [{ id: 'a', role: '招聘官', count: 1 }],
        })}
      />,
    );
    const row = screen.getByTestId('pm-project-form-team-row');
    fireEvent.change(within(row).getByTestId('pm-project-form-team-count'), {
      target: { value: '-3' },
    });
    const countInput = within(row).getByTestId('pm-project-form-team-count') as HTMLInputElement;
    expect(countInput.value).toBe('0');
  });

  it('sets the end-date input min attribute to the start-date value (UX hint)', () => {
    const start = new Date(2026, 5, 10).getTime();
    renderForm({ value: makeValue({ start_at: start }) });
    const endInput = screen.getByTestId('pm-project-form-end') as HTMLInputElement;
    expect(endInput.min).toBe('2026-06-10');
  });
});
