import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortPills, SORT_OPTIONS } from '../SortPills';

describe('SortPills', () => {
  it('renders 3 sort options with the active one highlighted', () => {
    render(<SortPills value="score" onChange={vi.fn()} />);
    expect(SORT_OPTIONS).toHaveLength(3);
    expect(screen.getByTestId('pm-sort-pill-score')).toHaveClass('active');
    expect(screen.getByTestId('pm-sort-pill-time')).not.toHaveClass('active');
    expect(screen.getByTestId('pm-sort-pill-salary')).not.toHaveClass('active');
  });

  it('fires onChange with the clicked option key', () => {
    const onChange = vi.fn();
    render(<SortPills value="score" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('pm-sort-pill-time'));
    expect(onChange).toHaveBeenCalledWith('time');
  });

  it('highlights the salary pill when value="salary"', () => {
    render(<SortPills value="salary" onChange={vi.fn()} />);
    expect(screen.getByTestId('pm-sort-pill-salary')).toHaveClass('active');
    expect(screen.getByTestId('pm-sort-pill-score')).not.toHaveClass('active');
  });

  it('highlights the time pill when value="time"', () => {
    render(<SortPills value="time" onChange={vi.fn()} />);
    expect(screen.getByTestId('pm-sort-pill-time')).toHaveClass('active');
    expect(screen.getByTestId('pm-sort-pill-salary')).not.toHaveClass('active');
  });
});
