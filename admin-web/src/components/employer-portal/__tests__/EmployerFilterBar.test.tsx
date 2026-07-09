import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EmployerFilterBar, EMPTY_FILTER, type EmployerFilter } from '../EmployerFilterBar';

// ---- Tests ----------------------------------------------------------------

describe('EmployerFilterBar — rendering', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the industry / level / skills / salary groups', () => {
    render(<EmployerFilterBar value={EMPTY_FILTER} onChange={() => {}} />);
    expect(screen.getByTestId('employer-filter-industry')).toBeInTheDocument();
    expect(screen.getByTestId('employer-filter-level')).toBeInTheDocument();
    expect(screen.getByTestId('employer-filter-skills')).toBeInTheDocument();
    expect(screen.getByTestId('employer-filter-salary')).toBeInTheDocument();
  });

  it('renders an industry chip for each configured industry option', () => {
    render(<EmployerFilterBar value={EMPTY_FILTER} onChange={() => {}} />);
    const group = screen.getByTestId('employer-filter-industry');
    // Each industry option gets a chip; we just assert the group is
    // populated with at least the chips we know about.
    expect(group.querySelectorAll('button[data-testid^="employer-filter-industry-chip-"]').length).toBeGreaterThanOrEqual(5);
    expect(group.querySelector('[data-testid="employer-filter-industry-chip-互联网"]')).toBeInTheDocument();
    expect(group.querySelector('[data-testid="employer-filter-industry-chip-金融"]')).toBeInTheDocument();
  });

  it('renders the level chips for junior / mid / senior / staff', () => {
    render(<EmployerFilterBar value={EMPTY_FILTER} onChange={() => {}} />);
    const group = screen.getByTestId('employer-filter-level');
    expect(group.querySelector('[data-testid="employer-filter-level-chip-junior"]')).toBeInTheDocument();
    expect(group.querySelector('[data-testid="employer-filter-level-chip-mid"]')).toBeInTheDocument();
    expect(group.querySelector('[data-testid="employer-filter-level-chip-senior"]')).toBeInTheDocument();
    expect(group.querySelector('[data-testid="employer-filter-level-chip-staff"]')).toBeInTheDocument();
  });
});

describe('EmployerFilterBar — interaction', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('clicking an industry chip toggles it in the value and fires onChange', () => {
    const onChange = vi.fn();
    const value: EmployerFilter = { ...EMPTY_FILTER, industry: [] };
    render(<EmployerFilterBar value={value} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('employer-filter-industry-chip-互联网'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as EmployerFilter;
    expect(next.industry).toEqual(['互联网']);
  });

  it('clicking an already-selected industry chip removes it from the value', () => {
    const onChange = vi.fn();
    const value: EmployerFilter = { ...EMPTY_FILTER, industry: ['互联网', '金融'] };
    render(<EmployerFilterBar value={value} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('employer-filter-industry-chip-互联网'));
    const next = onChange.mock.calls[0][0] as EmployerFilter;
    expect(next.industry).toEqual(['金融']);
  });

  it('typing in the skills input updates skills array (split on commas)', () => {
    const onChange = vi.fn();
    render(<EmployerFilterBar value={EMPTY_FILTER} onChange={onChange} />);

    const skillsInput = screen.getByTestId('employer-filter-skills-input') as HTMLInputElement;
    fireEvent.change(skillsInput, { target: { value: 'react, typescript, node' } });
    const next = onChange.mock.calls[0][0] as EmployerFilter;
    expect(next.skills).toEqual(['react', 'typescript', 'node']);
  });

  it('typing salary min/max updates the value', () => {
    const onChange = vi.fn();
    render(<EmployerFilterBar value={EMPTY_FILTER} onChange={onChange} />);

    const minInput = screen.getByTestId('employer-filter-salary-min') as HTMLInputElement;
    const maxInput = screen.getByTestId('employer-filter-salary-max') as HTMLInputElement;
    fireEvent.change(minInput, { target: { value: '30000' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ salary_min: 30000 }),
    );

    fireEvent.change(maxInput, { target: { value: '80000' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ salary_max: 80000 }),
    );
  });

  it('the reset button clears all filters', () => {
    const onChange = vi.fn();
    const dirty: EmployerFilter = {
      industry: ['互联网'],
      level: ['senior'],
      skills: ['react'],
      salary_min: 30000,
      salary_max: 80000,
    };
    render(<EmployerFilterBar value={dirty} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('employer-filter-reset'));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTER);
  });

  it('reflects the active industry selection visually (aria-pressed)', () => {
    const value: EmployerFilter = { ...EMPTY_FILTER, industry: ['金融'] };
    render(<EmployerFilterBar value={value} onChange={() => {}} />);
    const chip = screen.getByTestId('employer-filter-industry-chip-金融');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    const other = screen.getByTestId('employer-filter-industry-chip-互联网');
    expect(other.getAttribute('aria-pressed')).toBe('false');
  });
});