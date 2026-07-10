import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProjectPicker } from '../ProjectPicker';

describe('ProjectPicker', () => {
  const projects = [
    { id: 'p1', name: 'A' },
    { id: 'p2', name: 'B' },
  ];

  it('renders a select with all projects', () => {
    render(
      <ProjectPicker projects={projects} value="p1" onChange={vi.fn()} />,
    );
    const sel = screen.getByTestId('pm-project-picker');
    expect(sel.querySelectorAll('option')).toHaveLength(2);
  });

  it('fires onChange when selection changes', () => {
    const onChange = vi.fn();
    render(
      <ProjectPicker projects={projects} value="p1" onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId('pm-project-picker'), {
      target: { value: 'p2' },
    });
    expect(onChange).toHaveBeenCalledWith('p2');
  });
});