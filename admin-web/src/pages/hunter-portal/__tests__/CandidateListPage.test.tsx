import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CandidateListPage } from '../CandidateListPage';
import {
  recommendations,
  type RecommendationsListItem,
} from '../../../api/hunter-portal';

// ---- Mocks ----------------------------------------------------------------

// `useNavigate` is pulled from `react-router-dom`. We want the page's real
// instance so we can drive it via the MemoryRouter test entry; but for the
// "click navigates" tests we need a single shared navigate spy in case the
// detail route is missing. We mock the module once here and reuse it.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('../../../api/hunter-portal', () => ({
  recommendations: {
    list: vi.fn(),
  },
  // Re-export the types used by the page as pass-throughs so TypeScript
  // keeps compiling while the module is fully replaced at runtime.
  __esModule: true,
}));

const mockedList = vi.mocked(recommendations.list);

// ---- Fixture --------------------------------------------------------------

function makeItem(overrides: Partial<RecommendationsListItem> = {}): RecommendationsListItem {
  return {
    id: 'rec-default',
    candidate_user_id: 'u-default',
    candidate_name: '张*',
    job_id: 'j-default',
    job_title: '前端工程师',
    pipeline_stage: 'submitted',
    updated_at: Date.now() - 30 * 60_000, // 30 minutes ago
    ...overrides,
  };
}

// ---- Helpers --------------------------------------------------------------

interface RenderOpts {
  list?: RecommendationsListItem[];
  listReject?: Error;
}

function renderPage(opts: RenderOpts = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  if (opts.listReject) {
    mockedList.mockRejectedValueOnce(opts.listReject);
  } else if (opts.list) {
    mockedList.mockResolvedValueOnce(opts.list);
  } else {
    // Pending forever — keeps isLoading=true until the test resolves it.
    mockedList.mockReturnValueOnce(new Promise<RecommendationsListItem[]>(() => {}));
  }

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/hunter/candidates']}>
        <CandidateListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('CandidateListPage', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    // mockReset (not mockClear) so queued `mockResolvedValueOnce` from one
    // test does not leak into the next. `mockClear` only resets `.mock.calls`
    // and friends; the one-shot return queues survive it.
    mockedList.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the loading state while the query is pending', async () => {
    renderPage();
    expect(await screen.findByTestId('hp-candidates-loading')).toHaveTextContent('加载中');
    expect(screen.queryByTestId('hp-candidates-table')).toBeNull();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when the hunter owns no recommendations', async () => {
    renderPage({ list: [] });
    expect(await screen.findByText('暂无候选人')).toBeInTheDocument();
    expect(screen.queryByTestId('hp-candidates-table')).toBeNull();
    expect(mockedList).toHaveBeenCalledWith({});
  });

  it('renders the populated table with name, stage badge, job, and relative time', async () => {
    const now = Date.now();
    renderPage({
      list: [
        makeItem({
          id: 'rec-A',
          candidate_name: '张*',
          job_title: '前端工程师',
          pipeline_stage: 'submitted',
          updated_at: now - 2 * 60 * 60_000, // 2h ago
        }),
        makeItem({
          id: 'rec-B',
          candidate_user_id: 'u-2',
          candidate_name: '李*',
          job_title: '后端工程师',
          pipeline_stage: 'interview',
          updated_at: now - 26 * 60 * 60_000, // 26h ago → 1d ago
        }),
      ],
    });

    const table = await screen.findByTestId('hp-candidates-table');
    const rows = screen.getAllByTestId('hp-candidates-row');
    expect(rows.length).toBe(2);

    // First row: stage badge + job + relative time formatting.
    expect(rows[0]).toHaveTextContent('张*');
    expect(rows[0]).toHaveTextContent('前端工程师');
    expect(rows[0]).toHaveTextContent('2h ago');

    // PipelineStageBadge renders the Chinese label "投递" for `submitted`.
    expect(rows[0]).toHaveTextContent('投递');
    expect(rows[1]).toHaveTextContent('面试');
    expect(rows[1]).toHaveTextContent('1d ago');

    expect(rows[0].getAttribute('data-rec-id')).toBe('rec-A');
    expect(table).toBeInTheDocument();
  });

  it('falls back to (匿名) and "-" when candidate_name / job_title are missing', async () => {
    renderPage({
      list: [
        makeItem({
          id: 'rec-anon',
          candidate_user_id: null,
          candidate_name: null,
          job_title: null,
          pipeline_stage: 'rejected',
        }),
      ],
    });

    const rows = await screen.findAllByTestId('hp-candidates-row');
    expect(rows[0]).toHaveTextContent('(匿名)');
    expect(rows[0]).toHaveTextContent('-');
    expect(rows[0]).toHaveTextContent('已拒绝');
  });

  it('renders the error state when the list query rejects', async () => {
    renderPage({ listReject: new Error('网络异常') });

    const err = await screen.findByTestId('hp-candidates-error');
    expect(err).toHaveTextContent('加载失败');
    expect(err).toHaveTextContent('网络异常');
    expect(screen.queryByTestId('hp-candidates-table')).toBeNull();
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('invokes useNavigate("/hunter/candidates/:id") when a row is clicked', async () => {
    renderPage({
      list: [
        makeItem({ id: 'rec-click', candidate_name: '张*' }),
      ],
    });

    const row = await screen.findByTestId('hp-candidates-row');
    fireEvent.click(row);

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith('/hunter/candidates/rec-click');
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('updates the query key when the stage filter changes (refetches the list)', async () => {
    mockedList
      .mockResolvedValueOnce([makeItem({ id: 'rec-A', pipeline_stage: 'submitted' })])
      .mockResolvedValueOnce([makeItem({ id: 'rec-B', pipeline_stage: 'interview' })]);

    renderPage();

    await screen.findByTestId('hp-candidates-table');
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenLastCalledWith({});

    const select = screen.getByTestId('hp-candidates-stage') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'interview' } });
    expect(select.value).toBe('interview');

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledTimes(2);
    });
    expect(mockedList).toHaveBeenLastCalledWith({ stage: 'interview' });

    // The table now re-renders with the interview-stage row.
    const rows = await screen.findAllByTestId('hp-candidates-row');
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute('data-rec-id')).toBe('rec-B');
  });

  it('updates the query key when the keyword input changes (forwards to backend)', async () => {
    mockedList
      .mockResolvedValueOnce([makeItem({ id: 'rec-A' })])
      .mockResolvedValueOnce([makeItem({ id: 'rec-A' })]);

    renderPage();
    await screen.findByTestId('hp-candidates-table');
    expect(mockedList).toHaveBeenCalledTimes(1);

    const input = screen.getByTestId('hp-candidates-keyword') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '前' } });
    expect(input.value).toBe('前');

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledTimes(2);
    });
    expect(mockedList).toHaveBeenLastCalledWith({ keyword: '前' });
  });

  it('clears the keyword back to undefined when the input is emptied', async () => {
    mockedList
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    renderPage({ list: [] });
    await screen.findByText('暂无候选人');
    expect(mockedList).toHaveBeenLastCalledWith({});

    const input = screen.getByTestId('hp-candidates-keyword') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '没有' } });
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledTimes(2);
    });
    expect(mockedList).toHaveBeenLastCalledWith({ keyword: '没有' });

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledTimes(3);
    });
    // Empty string normalises to undefined so URLSearchParams skips the key.
    expect(mockedList).toHaveBeenLastCalledWith({});
  });

  it('switches between stage and keyword together through combined inputs', async () => {
    mockedList.mockResolvedValue([]);

    renderPage({ list: [] });
    await screen.findByText('暂无候选人');

    const select = screen.getByTestId('hp-candidates-stage') as HTMLSelectElement;
    const input = screen.getByTestId('hp-candidates-keyword') as HTMLInputElement;

    fireEvent.change(select, { target: { value: 'offer' } });
    fireEvent.change(input, { target: { value: '高级' } });

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith({ stage: 'offer', keyword: '高级' });
    });

    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith({ keyword: '高级' });
    });
  });
});
