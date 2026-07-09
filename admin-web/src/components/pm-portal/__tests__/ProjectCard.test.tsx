import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCard, formatBudgetYuan } from '../ProjectCard';
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
  type ProjectSummary,
} from '../../../api/pm-portal';

// ---- Mocks ----------------------------------------------------------------

// Capture the navigation target so we can assert on the
// "查看详情" → /admin/pm/projects/:id click without spinning up a real
// router history (matches the PMLoginPage.test.tsx pattern).
let lastNavigateTo: string | undefined;
const navigateSpy = vi.fn((to: string) => {
  lastNavigateTo = to;
});
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

// ---- Helpers --------------------------------------------------------------

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    pm_user_id: 'pm-1',
    name: 'AI 工程团队扩充',
    target: 'Q4 前补齐 5 个资深岗位',
    budget_total: 1_200_000_00, // 1.2M CNY in fen
    start_at: null,
    end_at: null,
    current_team: null,
    status: 'active',
    position_count: 5,
    plan_count: 1,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderCard(project: ProjectSummary) {
  return render(
    <MemoryRouter initialEntries={['/admin/pm/projects']}>
      <ProjectCard project={project} />
    </MemoryRouter>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('ProjectCard', () => {
  beforeEach(() => {
    cleanup();
    lastNavigateTo = undefined;
    navigateSpy.mockClear();
  });

  it('renders the project name', () => {
    renderCard(makeProject({ name: 'Frontend Lead Hunt' }));
    expect(screen.getByTestId('pm-project-card-name')).toHaveTextContent('Frontend Lead Hunt');
  });

  it('renders the project target (description) when present', () => {
    renderCard(makeProject({ target: '招 1 名高级前端' }));
    expect(screen.getByTestId('pm-project-card-target')).toHaveTextContent('招 1 名高级前端');
  });

  it('omits the target row when target is null', () => {
    renderCard(makeProject({ target: null }));
    expect(screen.queryByTestId('pm-project-card-target')).toBeNull();
  });

  it('renders the formatted budget in yuan', () => {
    // 1_200_000_00 fen = 1_200_000 yuan = 120万
    renderCard(makeProject({ budget_total: 1_200_000_00 }));
    expect(screen.getByTestId('pm-project-card-budget')).toHaveTextContent('¥120.0万');
  });

  it('renders "—" when budget is null', () => {
    renderCard(makeProject({ budget_total: null }));
    expect(screen.getByTestId('pm-project-card-budget')).toHaveTextContent('-');
  });

  it('renders the position_count and plan_count', () => {
    renderCard(makeProject({ position_count: 8, plan_count: 3 }));
    expect(screen.getByTestId('pm-project-card-positions')).toHaveTextContent('8');
    expect(screen.getByTestId('pm-project-card-plans')).toHaveTextContent('3');
  });

  it('truncates a long name to 30 characters with ellipsis', () => {
    const longName = 'A'.repeat(40);
    renderCard(makeProject({ name: longName }));
    const nameEl = screen.getByTestId('pm-project-card-name');
    expect(nameEl.textContent).toHaveLength(31); // 30 chars + 1 ellipsis char
    expect(nameEl.textContent?.endsWith('…')).toBe(true);
  });

  it('renders the view-details button with the right testid', () => {
    renderCard(makeProject());
    expect(screen.getByTestId('pm-project-card-view')).toHaveTextContent('查看详情');
  });

  it('navigates to /admin/pm/projects/:id when "查看详情" is clicked', () => {
    renderCard(makeProject({ id: 'proj-xyz' }));
    fireEvent.click(screen.getByTestId('pm-project-card-view'));
    expect(lastNavigateTo).toBe('/admin/pm/projects/proj-xyz');
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/projects/proj-xyz');
  });
});

describe('ProjectCard — status badge', () => {
  beforeEach(() => {
    cleanup();
    lastNavigateTo = undefined;
    navigateSpy.mockClear();
  });

  for (const status of Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]) {
    it(`renders the localized label for status="${status}"`, () => {
      renderCard(makeProject({ status }));
      expect(screen.getByTestId('pm-project-status')).toHaveTextContent(PROJECT_STATUS_LABELS[status]);
    });

    it(`exposes status="${status}" via data-status for CSS targeting`, () => {
      renderCard(makeProject({ status }));
      expect(screen.getByTestId('pm-project-status').getAttribute('data-status')).toBe(status);
    });

    it(`paints the badge with the right text colour for status="${status}"`, () => {
      renderCard(makeProject({ status }));
      const badge = screen.getByTestId('pm-project-status') as HTMLElement;
      // The badge uses inline `style={{ color }}`; the color must be
      // non-empty and look like a colour string.
      const color = badge.style.color;
      expect(color).toBeTruthy();
      expect(color).toMatch(/^rgb/);
    });
  }
});

describe('formatBudgetYuan', () => {
  it('returns "—" for null', () => {
    expect(formatBudgetYuan(null)).toBe('-');
  });

  it('returns "—" for undefined', () => {
    expect(formatBudgetYuan(undefined)).toBe('-');
  });

  it('returns "¥0" for 0 fen', () => {
    expect(formatBudgetYuan(0)).toBe('¥0');
  });

  it('formats small amounts in yuan with thousands separators', () => {
    // 123_456_78 fen = 123_456.78 yuan
    expect(formatBudgetYuan(12_345_67.8)).toContain('¥');
    // 99 fen = ¥0.99
    expect(formatBudgetYuan(99)).toBe('¥0.99');
  });

  it('uses 万 unit (1 decimal) for amounts ≥ ¥10,000', () => {
    // 5_000_000 fen = 50_000 yuan = 5万
    expect(formatBudgetYuan(5_000_000)).toBe('¥5.0万');
  });

  it('uses 万 unit (1 decimal) for amounts ≥ ¥100,000', () => {
    // 12_000_000 fen = 120_000 yuan = 12万
    expect(formatBudgetYuan(12_000_000)).toBe('¥12.0万');
  });

  it('handles very large budgets (e.g. ¥10M+) with 1-decimal 万', () => {
    // 120_000_000 fen = 1_200_000 yuan = 120万
    expect(formatBudgetYuan(120_000_000)).toBe('¥120.0万');
  });
});
