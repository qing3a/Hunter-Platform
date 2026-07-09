import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CandidateLibraryPage } from '../CandidateLibraryPage';
import {
  pmLibrary,
  pmNotes,
  type LibraryCandidate,
  type PmPrivateNote,
} from '../../../api/pm-portal';
import { ToastProvider } from '../../../lib/toast';

// ---- Mocks ----------------------------------------------------------------

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('../../../api/pm-portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/pm-portal')>();
  return {
    ...actual,
    pmLibrary: {
      list: vi.fn(),
    },
    pmNotes: {
      get: vi.fn(),
      update: vi.fn(),
    },
  };
});

const mockedList = vi.mocked(pmLibrary.list);
const mockedNotesGet = vi.mocked(pmNotes.get);
const mockedNotesUpdate = vi.mocked(pmNotes.update);

// ---- Helpers --------------------------------------------------------------

function makeCandidate(overrides: Partial<LibraryCandidate> = {}): LibraryCandidate {
  return {
    candidate_user_id: 'cand-1',
    display_name: '张*三',
    current_best_match: {
      score: 90,
      position_title: '高级前端工程师',
      position_id: 'pos-1',
      project_name: 'AI 工程',
      project_id: 'proj-1',
    },
    position_count: 3,
    ...overrides,
  };
}

function makeNote(overrides: Partial<PmPrivateNote> = {}): PmPrivateNote {
  return {
    starred: false,
    note_text: '',
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/admin/pm/library']}>
          <CandidateLibraryPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Loading / error / empty
// ============================================================================

describe('CandidateLibraryPage — loading + error + empty', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('renders the title + a loading state while pmLibrary.list is in flight', () => {
    mockedList.mockReturnValue(new Promise(() => {}));
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    expect(screen.getByTestId('pm-library-title')).toHaveTextContent('候选人库');
    expect(screen.getByTestId('pm-library-loading')).toBeInTheDocument();
  });

  it('renders an error banner when pmLibrary.list rejects', async () => {
    mockedList.mockRejectedValueOnce(new Error('网络异常'));
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pm-library-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-library-error')).toHaveTextContent('网络异常');
  });

  it('renders the empty-state when there are zero aggregated candidates', async () => {
    mockedList.mockResolvedValueOnce({ candidates: [], total: 0 });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无候选人')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Stats
// ============================================================================

describe('CandidateLibraryPage — stats strip', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('renders KPI tiles with total / recommendations / starred / notes counts', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [
        makeCandidate({
          candidate_user_id: 'cand-1',
          display_name: '张*三',
          position_count: 3,
          current_best_match: {
            score: 90,
            position_title: '高级前端工程师',
            position_id: 'pos-1',
            project_name: 'Project A',
            project_id: 'proj-1',
          },
        }),
        makeCandidate({
          candidate_user_id: 'cand-2',
          display_name: '李*四',
          position_count: 2,
          current_best_match: {
            score: 75,
            position_title: '全栈工程师',
            position_id: 'pos-2',
            project_name: 'Project B',
            project_id: 'proj-2',
          },
        }),
      ],
      total: 2,
    });
    // cand-1 is starred, cand-2 has a note.
    mockedNotesGet.mockImplementation(async (userId: string) => {
      if (userId === 'cand-1') return makeNote({ starred: true });
      if (userId === 'cand-2') return makeNote({ note_text: '已沟通' });
      return makeNote();
    });

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    const total = screen.getByTestId('pm-library-kpi-total');
    expect(within(total).getByText('候选人数')).toBeInTheDocument();
    expect(within(total).getByTestId('pm-library-kpi-total-value')).toHaveTextContent('2');

    const recs = screen.getByTestId('pm-library-kpi-recommendations');
    expect(within(recs).getByText('推荐数')).toBeInTheDocument();
    expect(within(recs).getByTestId('pm-library-kpi-recommendations-value')).toHaveTextContent('5');

    const starred = screen.getByTestId('pm-library-kpi-starred');
    expect(within(starred).getByTestId('pm-library-kpi-starred-value')).toHaveTextContent('1');

    const notes = screen.getByTestId('pm-library-kpi-notes');
    expect(within(notes).getByTestId('pm-library-kpi-notes-value')).toHaveTextContent('1');
  });
});

// ============================================================================
// Table view (default)
// ============================================================================

describe('CandidateLibraryPage — table view (default)', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('renders the table by default and lists every candidate row', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [
        makeCandidate({ candidate_user_id: 'cand-1', display_name: '张*三' }),
        makeCandidate({
          candidate_user_id: 'cand-2',
          display_name: '李*四',
          current_best_match: {
            score: 75,
            position_title: '全栈工程师',
            position_id: 'pos-2',
            project_name: 'Project B',
            project_id: 'proj-2',
          },
        }),
      ],
      total: 2,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    expect(screen.getByTestId('pm-library-table')).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^pm-library-row-\d+$/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-candidate-user-id', 'cand-1');
    expect(rows[1]).toHaveAttribute('data-candidate-user-id', 'cand-2');
  });

  it('renders rows in the order pmLibrary.list returned (sorted server-side)', async () => {
    // The page is a pass-through: it renders candidates in the
    // order returned by `pmLibrary.list()`. Sorting is the API's
    // responsibility (the stub enforces best_score DESC). This test
    // documents the contract rather than re-implementing the sort.
    mockedList.mockResolvedValueOnce({
      candidates: [
        makeCandidate({
          candidate_user_id: 'cand-1',
          display_name: '张*三',
          current_best_match: {
            score: 95,
            position_title: '高级前端工程师',
            position_id: 'pos-1',
            project_name: 'Project A',
            project_id: 'proj-1',
          },
        }),
        makeCandidate({
          candidate_user_id: 'cand-2',
          display_name: '李*四',
          current_best_match: {
            score: 60,
            position_title: '全栈工程师',
            position_id: 'pos-2',
            project_name: 'Project B',
            project_id: 'proj-2',
          },
        }),
      ],
      total: 2,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    const rows = screen.getAllByTestId(/^pm-library-row-\d+$/);
    expect(rows[0]).toHaveAttribute('data-candidate-user-id', 'cand-1');
    expect(rows[0]).toHaveAttribute('data-score', '95');
    expect(rows[1]).toHaveAttribute('data-candidate-user-id', 'cand-2');
    expect(rows[1]).toHaveAttribute('data-score', '60');
  });
});

// ============================================================================
// View toggle
// ============================================================================

describe('CandidateLibraryPage — view toggle', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('switches to card view when the "卡片" button is clicked', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.click(screen.getByTestId('pm-library-view-card'));
    await waitFor(() => screen.getByTestId('pm-library-cards'));
    expect(screen.queryByTestId('pm-library-table')).toBeNull();
  });

  it('switches back to table view when "表格" is clicked', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    localStorage.setItem('pm.library.candidates.viewMode', 'card');

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-cards'));
    fireEvent.click(screen.getByTestId('pm-library-view-table'));
    await waitFor(() => screen.getByTestId('pm-library-table'));
    expect(screen.queryByTestId('pm-library-cards')).toBeNull();
  });

  it('persists the chosen viewMode in localStorage', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));

    fireEvent.click(screen.getByTestId('pm-library-view-card'));
    await flush();
    expect(localStorage.getItem('pm.library.candidates.viewMode')).toBe('card');

    fireEvent.click(screen.getByTestId('pm-library-view-table'));
    await flush();
    expect(localStorage.getItem('pm.library.candidates.viewMode')).toBe('table');
  });

  it('hydrates the viewMode from localStorage on remount', async () => {
    mockedList.mockResolvedValue({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    localStorage.setItem('pm.library.candidates.viewMode', 'card');

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-cards'));
    expect(screen.getByTestId('pm-library-view-card')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('pm-library-view-table')).toHaveAttribute('data-active', 'false');
  });
});

// ============================================================================
// Search
// ============================================================================

describe('CandidateLibraryPage — search', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('filters rows by display_name (case-insensitive, substring)', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [
        makeCandidate({ candidate_user_id: 'cand-1', display_name: '张*三' }),
        makeCandidate({
          candidate_user_id: 'cand-2',
          display_name: '李*四',
          current_best_match: {
            score: 75,
            position_title: '全栈工程师',
            position_id: 'pos-2',
            project_name: 'Project B',
            project_id: 'proj-2',
          },
        }),
      ],
      total: 2,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    expect(screen.getAllByTestId(/^pm-library-row-\d+$/)).toHaveLength(2);

    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: '张' },
    });
    await flush();
    const rows = screen.getAllByTestId(/^pm-library-row-\d+$/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-candidate-user-id', 'cand-1');
  });

  it('falls back to candidate_user_id when display_name is null', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [
        makeCandidate({ candidate_user_id: 'cand-abc', display_name: null }),
        makeCandidate({
          candidate_user_id: 'cand-xyz',
          display_name: '李*四',
          current_best_match: {
            score: 75,
            position_title: '全栈工程师',
            position_id: 'pos-2',
            project_name: 'Project B',
            project_id: 'proj-2',
          },
        }),
      ],
      total: 2,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: 'abc' },
    });
    await flush();
    const rows = screen.getAllByTestId(/^pm-library-row-\d+$/);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-candidate-user-id', 'cand-abc');
  });

  it('shows the no-match empty state when the query hides every row', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate({ candidate_user_id: 'cand-1', display_name: 'Alpha' })],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.change(screen.getByTestId('pm-library-search'), {
      target: { value: 'zzz-no-match' },
    });
    await flush();
    expect(screen.getByText('没有匹配的候选人')).toBeInTheDocument();
    expect(screen.queryByTestId('pm-library-table')).toBeNull();
  });
});

// ============================================================================
// Star toggle
// ============================================================================

describe('CandidateLibraryPage — star toggle', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('dispatches pmNotes.update with starred=true when the ⭐ is clicked', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    mockedNotesUpdate.mockResolvedValue(makeNote({ starred: true }));

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.click(screen.getByTestId('pm-library-row-0-star'));
    await waitFor(() => {
      expect(mockedNotesUpdate).toHaveBeenCalledWith('cand-1', { starred: true });
    });
  });

  it('dispatches pmNotes.update with starred=false to unstar', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote({ starred: true }));
    mockedNotesUpdate.mockResolvedValue(makeNote({ starred: false }));

    renderPage();
    await waitFor(() => {
      const row = screen.getByTestId('pm-library-row-0');
      expect(row).toHaveAttribute('data-starred', 'true');
    });
    fireEvent.click(screen.getByTestId('pm-library-row-0-star'));
    await waitFor(() => {
      expect(mockedNotesUpdate).toHaveBeenCalledWith('cand-1', { starred: false });
    });
  });

  it('optimistically reflects the new starred state on the row before the request resolves', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    // Never-resolving promise keeps the request in flight so we can
    // observe the optimistic value.
    mockedNotesUpdate.mockReturnValue(new Promise(() => {}));

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.click(screen.getByTestId('pm-library-row-0-star'));
    await flush();
    const row = screen.getByTestId('pm-library-row-0');
    expect(row).toHaveAttribute('data-starred', 'true');
  });

  it('rolls back the optimistic star if pmNotes.update rejects', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate()],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());
    mockedNotesUpdate.mockRejectedValueOnce(new Error('网络异常'));

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.click(screen.getByTestId('pm-library-row-0-star'));
    await waitFor(() => {
      expect(mockedNotesUpdate).toHaveBeenCalledWith('cand-1', { starred: true });
    });
    // After the rollback the row should be unstarred again.
    await waitFor(() => {
      expect(screen.getByTestId('pm-library-row-0')).toHaveAttribute('data-starred', 'false');
    });
  });
});

// ============================================================================
// Click-through
// ============================================================================

describe('CandidateLibraryPage — click-through', () => {
  beforeEach(() => {
    cleanup();
    navigateSpy.mockClear();
    mockedList.mockReset();
    mockedNotesGet.mockReset();
    mockedNotesUpdate.mockReset();
    localStorage.clear();
  });

  it('navigates to /admin/pm/candidates/:userId when 查看详情 is clicked', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate({ candidate_user_id: 'cand-42' })],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.click(screen.getByTestId('pm-library-row-0-detail'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/candidates/cand-42');
  });

  it('navigates to /admin/pm/candidates/:userId from card view too', async () => {
    mockedList.mockResolvedValueOnce({
      candidates: [makeCandidate({ candidate_user_id: 'cand-7' })],
      total: 1,
    });
    mockedNotesGet.mockResolvedValue(makeNote());

    renderPage();
    await waitFor(() => screen.getByTestId('pm-library-table'));
    fireEvent.click(screen.getByTestId('pm-library-view-card'));
    await waitFor(() => screen.getByTestId('pm-library-cards'));
    fireEvent.click(screen.getByTestId('pm-library-row-0-detail'));
    expect(navigateSpy).toHaveBeenCalledWith('/admin/pm/candidates/cand-7');
  });
});