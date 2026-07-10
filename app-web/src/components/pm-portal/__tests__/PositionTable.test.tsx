import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { PositionTable } from '../PositionTable';
import { TITLE_LEVEL_LABELS } from '../../../api/pm-portal';
import type { Position, TitleLevel } from '../../../api/pm-portal';

// ---- Helpers --------------------------------------------------------------

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    project_id: 'proj-1',
    title: 'Senior Frontend Engineer',
    description: null,
    required_skills: ['React', 'TypeScript'],
    title_level: 'senior',
    industry: 'FinTech',
    salary_min: 20000,
    salary_max: 40000,
    status: 'open',
    headcount_planned: 2,
    headcount_filled: 0,
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderTable(
  positions: Position[],
  props: Partial<React.ComponentProps<typeof PositionTable>> = {},
) {
  const onRowClick = props.onRowClick ?? vi.fn();
  return {
    onRowClick,
    ...render(
      <PositionTable
        positions={positions}
        loading={false}
        onRowClick={onRowClick}
        {...props}
      />,
    ),
  };
}

// ---- Tests ----------------------------------------------------------------

describe('PositionTable', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders a loading state when loading=true', () => {
    renderTable([], { loading: true });
    expect(screen.getByTestId('pm-positions-loading')).toBeInTheDocument();
  });

  it('renders an empty state when there are no positions', () => {
    renderTable([]);
    expect(screen.getByTestId('pm-positions-empty')).toBeInTheDocument();
    expect(screen.getByText('暂无岗位')).toBeInTheDocument();
  });

  it('renders one row per position with the expected columns', () => {
    const positions = [
      makePosition({ id: 'a', title: 'Engineer A' }),
      makePosition({ id: 'b', title: 'Engineer B' }),
    ];
    renderTable(positions);
    const rows = screen.getAllByTestId('pm-position-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Engineer A')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Engineer B')).toBeInTheDocument();
  });

  it('renders the headcount cell as "filled / planned" with a slash', () => {
    renderTable([
      makePosition({ id: 'a', headcount_planned: 3, headcount_filled: 1 }),
    ]);
    const row = screen.getByTestId('pm-position-row');
    expect(within(row).getByTestId('pm-position-headcount')).toHaveTextContent('1 / 3');
  });

  it('renders the title level label when present', () => {
    renderTable([makePosition({ title_level: 'staff' })]);
    const row = screen.getByTestId('pm-position-row');
    expect(within(row).getByTestId('pm-position-level')).toHaveTextContent(TITLE_LEVEL_LABELS.staff);
  });

  it('renders a dash when title_level is null', () => {
    renderTable([makePosition({ title_level: null })]);
    const row = screen.getByTestId('pm-position-row');
    expect(within(row).getByTestId('pm-position-level')).toHaveTextContent('-');
  });

  it('renders required_skills as comma-joined chips (truncated to 4 + overflow)', () => {
    const skills = ['React', 'TypeScript', 'Node', 'GraphQL', 'AWS', 'Docker'];
    renderTable([makePosition({ required_skills: skills })]);
    const row = screen.getByTestId('pm-position-row');
    const skillsCell = within(row).getByTestId('pm-position-skills');
    // 4 visible + "+2"
    expect(skillsCell).toHaveTextContent('React, TypeScript, Node, GraphQL');
    expect(skillsCell).toHaveTextContent('+2');
  });

  it('renders an empty placeholder when required_skills is empty', () => {
    renderTable([makePosition({ required_skills: [] })]);
    const row = screen.getByTestId('pm-position-row');
    expect(within(row).getByTestId('pm-position-skills')).toHaveTextContent('-');
  });

  it('calls onRowClick with the position id when a row is clicked', () => {
    const onRowClick = vi.fn();
    renderTable(
      [makePosition({ id: 'p-click' })],
      { onRowClick },
    );
    fireEvent.click(screen.getByTestId('pm-position-row'));
    expect(onRowClick).toHaveBeenCalledWith('p-click');
  });

  it('exposes a filter input that filters rows by title (case-insensitive)', () => {
    renderTable([
      makePosition({ id: 'a', title: 'Frontend Lead' }),
      makePosition({ id: 'b', title: 'Backend Architect' }),
    ]);
    const search = screen.getByTestId('pm-positions-search');
    fireEvent.change(search, { target: { value: 'backend' } });
    const rows = screen.getAllByTestId('pm-position-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Backend Architect');
  });

  it('exposes a status filter that filters rows by status (exact match)', () => {
    renderTable([
      makePosition({ id: 'a', status: 'open' }),
      makePosition({ id: 'b', status: 'paused' }),
      makePosition({ id: 'c', status: 'filled' }),
    ]);
    const filter = screen.getByTestId('pm-positions-status-filter');
    fireEvent.change(filter, { target: { value: 'paused' } });
    const rows = screen.getAllByTestId('pm-position-row');
    expect(rows).toHaveLength(1);
    // The lifecycle status column was removed in Task 5; verify the filter
    // by asserting the surviving row corresponds to the paused position.
    expect(rows[0]!.getAttribute('data-position-id')).toBe('b');
  });

  it('combines search and status filter (intersection)', () => {
    renderTable([
      makePosition({ id: 'a', title: 'AI Engineer', status: 'open' }),
      makePosition({ id: 'b', title: 'AI Architect', status: 'paused' }),
      makePosition({ id: 'c', title: 'Mobile Engineer', status: 'open' }),
    ]);
    fireEvent.change(screen.getByTestId('pm-positions-search'), { target: { value: 'ai' } });
    fireEvent.change(screen.getByTestId('pm-positions-status-filter'), { target: { value: 'paused' } });
    const rows = screen.getAllByTestId('pm-position-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('AI Architect');
  });

  it('renders a "no match" empty state when filters hide all rows', () => {
    renderTable([
      makePosition({ id: 'a', title: 'Engineer' }),
    ]);
    fireEvent.change(screen.getByTestId('pm-positions-search'), {
      target: { value: 'zzz-no-match' },
    });
    expect(screen.getByTestId('pm-positions-no-match')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-position-row')).toBeNull();
  });

  it('renders the table header with seven columns (岗位 / 级别 / 数量 / 必须技能 / 到岗 / 薪资 / ERP 状态)', () => {
    renderTable([makePosition()]);
    const table = screen.getByTestId('pm-positions-table');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      '岗位', '级别', '数量', '必须技能', '到岗', '薪资', 'ERP 状态',
    ]);
  });

  it('renders the PublishStatus chip in the ERP 状态 column', () => {
    renderTable([makePosition()]);
    const row = screen.getByTestId('pm-position-row');
    const cells = within(row).getAllByRole('cell');
    // 7th column (index 6) is ERP 状态
    expect(cells[6]).toHaveTextContent('未发布');
  });

  it('uses every TitleLevel in the union at least once across positions (compile check)', () => {
    // Compile-time guard: this loop typechecks against the TitleLevel union.
    const levels: TitleLevel[] = ['junior', 'mid', 'senior', 'staff'];
    renderTable(levels.map((l) => makePosition({ id: `p-${l}`, title_level: l })));
    const rows = screen.getAllByTestId('pm-position-row');
    expect(rows).toHaveLength(4);
  });
});
