import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  LibraryFilterBar,
  type LibraryViewMode,
} from '../LibraryFilterBar';

// ---- Helpers --------------------------------------------------------------

interface RenderProps {
  search?: string;
  viewMode?: LibraryViewMode;
  searchPlaceholder?: string;
}

function renderBar({
  search = '',
  viewMode = 'table',
  searchPlaceholder,
}: RenderProps = {}) {
  const onSearch = vi.fn();
  const onViewMode = vi.fn();
  render(
    <LibraryFilterBar
      search={search}
      onSearch={onSearch}
      viewMode={viewMode}
      onViewMode={onViewMode}
      searchPlaceholder={searchPlaceholder}
    />,
  );
  return { onSearch, onViewMode };
}

// ============================================================================
// Tests
// ============================================================================

describe('LibraryFilterBar', () => {
  beforeEach(() => {
    cleanup();
  });

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
    renderBar({ search: '张' });
    const input = screen.getByTestId('pm-library-search') as HTMLInputElement;
    expect(input.value).toBe('张');
  });

  it('dispatches onSearch when the user types in the search input', () => {
    const { onSearch } = renderBar();
    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: 'react' },
    });
    expect(onSearch).toHaveBeenCalledWith('react');
  });

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

  it('dispatches onViewMode(\'card\') when the card button is clicked', () => {
    const { onViewMode } = renderBar({ viewMode: 'table' });
    fireEvent.click(screen.getByTestId('pm-library-view-card'));
    expect(onViewMode).toHaveBeenCalledWith('card');
  });

  it('dispatches onViewMode(\'table\') when the table button is clicked', () => {
    const { onViewMode } = renderBar({ viewMode: 'card' });
    fireEvent.click(screen.getByTestId('pm-library-view-table'));
    expect(onViewMode).toHaveBeenCalledWith('table');
  });
});