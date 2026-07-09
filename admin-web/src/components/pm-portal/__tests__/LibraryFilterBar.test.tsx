import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  LibraryFilterBar,
  type LibraryViewMode,
  type LibraryFilterValue,
} from '../LibraryFilterBar';

// ---- Helpers --------------------------------------------------------------

interface RenderProps {
  value?: LibraryFilterValue;
  onChange?: (next: LibraryFilterValue) => void;
  viewMode?: LibraryViewMode;
  onViewModeChange?: (next: LibraryViewMode) => void;
  searchPlaceholder?: string;
}

function defaultValue(): LibraryFilterValue {
  return { search: '', source: 'all', annotation: 'all' };
}

function renderBar({
  value,
  onChange,
  viewMode = 'table',
  onViewModeChange,
  searchPlaceholder,
}: RenderProps = {}) {
  const _onChange = onChange ?? vi.fn();
  const _onViewModeChange = onViewModeChange ?? vi.fn();
  render(
    <LibraryFilterBar
      value={value ?? defaultValue()}
      onChange={_onChange}
      viewMode={viewMode}
      onViewModeChange={_onViewModeChange}
      searchPlaceholder={searchPlaceholder}
    />,
  );
  return { onChange: _onChange, onViewModeChange: _onViewModeChange };
}

// ============================================================================
// Tests
// ============================================================================

describe('LibraryFilterBar', () => {
  beforeEach(() => {
    cleanup();
  });

  // ---- search input -------------------------------------------------------

  it('renders the search input + the two view-mode buttons', () => {
    renderBar();
    expect(screen.getByTestId('pm-library-search')).toBeInTheDocument();
    expect(screen.getByTestId('pm-library-view-table')).toBeInTheDocument();
    expect(screen.getByTestId('pm-library-view-card')).toBeInTheDocument();
  });

  it('uses the supplied placeholder on the search input', () => {
    renderBar({ searchPlaceholder: '搜索候选人的名字' });
    const input = screen.getByTestId('pm-library-search') as HTMLInputElement;
    expect(input.placeholder).toBe('搜索候选人的名字');
    expect(input.getAttribute('aria-label')).toBe('搜索候选人的名字');
  });

  it('falls back to the default placeholder when none is provided', () => {
    renderBar();
    const input = screen.getByTestId('pm-library-search') as HTMLInputElement;
    expect(input.placeholder).toBe('搜索候选人 (姓名 / 技能)');
  });

  it('reflects the current search value via the controlled input', () => {
    renderBar({ value: { search: '张', source: 'all', annotation: 'all' } });
    const input = screen.getByTestId('pm-library-search') as HTMLInputElement;
    expect(input.value).toBe('张');
  });

  it('dispatches onChange with the next search value when the user types', () => {
    const { onChange } = renderBar({
      value: { search: '', source: 'all', annotation: 'all' },
    });
    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: 'react' },
    });
    expect(onChange).toHaveBeenCalledWith({
      search: 'react',
      source: 'all',
      annotation: 'all',
    });
  });

  // ---- view toggle --------------------------------------------------------

  it('marks the table button as active when viewMode=table', () => {
    renderBar({ viewMode: 'table' });
    expect(screen.getByTestId('pm-library-view-table')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('pm-library-view-card')).toHaveAttribute('data-active', 'false');
  });

  it('marks the card button as active when viewMode=card', () => {
    renderBar({ viewMode: 'card' });
    expect(screen.getByTestId('pm-library-view-card')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('pm-library-view-table')).toHaveAttribute('data-active', 'false');
  });

  it('dispatches onViewModeChange("card") when the card button is clicked', () => {
    const { onViewModeChange } = renderBar({ viewMode: 'table' });
    fireEvent.click(screen.getByTestId('pm-library-view-card'));
    expect(onViewModeChange).toHaveBeenCalledWith('card');
  });

  it('dispatches onViewModeChange("table") when the table button is clicked', () => {
    const { onViewModeChange } = renderBar({ viewMode: 'card' });
    fireEvent.click(screen.getByTestId('pm-library-view-table'));
    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  // ---- source + annotation selects (Task 14 / S9) -------------------------

  it('renders source select with 5 options', () => {
    renderBar();
    const sel = screen.getByTestId('pm-library-source') as HTMLSelectElement;
    expect(sel.querySelectorAll('option')).toHaveLength(5);
    expect(sel.value).toBe('all');
  });

  it('renders annotation select with 3 options', () => {
    renderBar();
    const sel = screen.getByTestId('pm-library-annotation') as HTMLSelectElement;
    expect(sel.querySelectorAll('option')).toHaveLength(3);
    expect(sel.value).toBe('all');
  });

  it('reflects the controlled source value on the select', () => {
    renderBar({ value: { search: '', source: '内推', annotation: 'all' } });
    const sel = screen.getByTestId('pm-library-source') as HTMLSelectElement;
    expect(sel.value).toBe('内推');
  });

  it('reflects the controlled annotation value on the select', () => {
    renderBar({ value: { search: '', source: 'all', annotation: 'starred' } });
    const sel = screen.getByTestId('pm-library-annotation') as HTMLSelectElement;
    expect(sel.value).toBe('starred');
  });

  it('dispatches onChange with the next source when the user picks one', () => {
    const { onChange } = renderBar({
      value: { search: '', source: 'all', annotation: 'all' },
    });
    fireEvent.change(screen.getByTestId('pm-library-source'), {
      target: { value: '主动寻访' },
    });
    expect(onChange).toHaveBeenCalledWith({
      search: '',
      source: '主动寻访',
      annotation: 'all',
    });
  });

  it('dispatches onChange with the next annotation when the user picks one', () => {
    const { onChange } = renderBar({
      value: { search: '', source: 'all', annotation: 'all' },
    });
    fireEvent.change(screen.getByTestId('pm-library-annotation'), {
      target: { value: 'noted' },
    });
    expect(onChange).toHaveBeenCalledWith({
      search: '',
      source: 'all',
      annotation: 'noted',
    });
  });
});