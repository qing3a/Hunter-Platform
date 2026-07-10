import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { KanbanPage } from '../KanbanPage';
import {
  kanban,
  type KanbanCard,
  type KanbanColumn,
  type PipelineStage,
} from '../../../api/hunter-portal';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/hunter-portal', () => ({
  kanban: {
    get: vi.fn(),
    move: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockedGet = vi.mocked(kanban.get);
const mockedMove = vi.mocked(kanban.move);

// ---- Fixture --------------------------------------------------------------

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    recommendation_id: 'rec-default',
    candidate_user_id: 'u-default',
    candidate_name: '张*',
    job_id: 'j-default',
    job_title: '前端工程师',
    match_score: 0.85,
    pipeline_stage: 'submitted',
    kanban_position: 0,
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeColumn(overrides: Partial<KanbanColumn> = {}): KanbanColumn {
  return {
    id: 1,
    hunter_user_id: 'h-1',
    name: '投递',
    position: 0,
    pipeline_stage: 'submitted',
    created_at: 0,
    cards: [],
    ...overrides,
  };
}

function makeBoard(
  cardsByStage: Partial<Record<PipelineStage, KanbanCard[]>> = {},
): { columns: KanbanColumn[] } {
  const columns: KanbanColumn[] = [
    makeColumn({
      id: 1,
      name: '投递',
      position: 0,
      pipeline_stage: 'submitted',
      cards: cardsByStage.submitted ?? [],
    }),
    makeColumn({
      id: 2,
      name: '简历过',
      position: 1,
      pipeline_stage: 'screen_passed',
      cards: cardsByStage.screen_passed ?? [],
    }),
    makeColumn({
      id: 3,
      name: '面试',
      position: 2,
      pipeline_stage: 'interview',
      cards: cardsByStage.interview ?? [],
    }),
    makeColumn({
      id: 4,
      name: 'Offer',
      position: 3,
      pipeline_stage: 'offer',
      cards: cardsByStage.offer ?? [],
    }),
    makeColumn({
      id: 5,
      name: '到岗',
      position: 4,
      pipeline_stage: 'onboarded',
      cards: cardsByStage.onboarded ?? [],
    }),
    makeColumn({
      id: 6,
      name: '已拒绝',
      position: 5,
      pipeline_stage: 'rejected',
      cards: cardsByStage.rejected ?? [],
    }),
  ];
  return { columns };
}

// ---- Helpers --------------------------------------------------------------

interface RenderOpts {
  board?: { columns: KanbanColumn[] };
  boardReject?: Error;
  moveResolve?: KanbanCard;
  moveReject?: Error;
}

function renderPage(opts: RenderOpts = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  if (opts.boardReject) {
    mockedGet.mockRejectedValueOnce(opts.boardReject);
  } else if (opts.board) {
    mockedGet.mockResolvedValueOnce(opts.board);
  } else {
    mockedGet.mockReturnValueOnce(new Promise<{ columns: KanbanColumn[] }>(() => {}));
  }

  if (opts.moveReject) {
    mockedMove.mockRejectedValue(opts.moveReject);
  } else if (opts.moveResolve) {
    mockedMove.mockResolvedValue(opts.moveResolve);
  }

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/hunter/kanban']}>
        <KanbanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Drive the drag-and-drop flow directly via fireEvent (jsdom has limited
// native drag support). The page stores the dragged card in React state, so
// calling onDragStart fires that, and onDrop reads it back.
function dragCardToColumn(card: HTMLElement, column: HTMLElement) {
  fireEvent.dragStart(card);
  fireEvent.dragOver(column);
  fireEvent.drop(column);
}

// ---- Tests ----------------------------------------------------------------

describe('KanbanPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the loading state while the kanban query is pending', async () => {
    renderPage();
    expect(await screen.findByTestId('hp-kanban-loading')).toHaveTextContent('加载中');
    expect(screen.queryByTestId('hp-kanban-board')).toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('renders 5 columns (submitted → onboarded) for the active pipeline', async () => {
    renderPage({ board: makeBoard() });
    const columns = await screen.findAllByTestId('hp-kanban-column');
    // Backend returns 6 columns (5 active + rejected); the page renders them all.
    expect(columns.length).toBeGreaterThanOrEqual(5);
    expect(columns.length).toBe(6);

    const stages = columns.map((c) => c.getAttribute('data-stage'));
    expect(stages).toEqual([
      'submitted',
      'screen_passed',
      'interview',
      'offer',
      'onboarded',
      'rejected',
    ]);
  });

  it('renders cards within the correct column for each pipeline stage', async () => {
    const submittedCard = makeCard({
      recommendation_id: 'rec-sub',
      candidate_name: '张一',
      job_title: '前端工程师',
      pipeline_stage: 'submitted',
    });
    const screenCard = makeCard({
      recommendation_id: 'rec-scr',
      candidate_name: '张二',
      job_title: '后端工程师',
      pipeline_stage: 'screen_passed',
    });
    const interviewCard = makeCard({
      recommendation_id: 'rec-int',
      candidate_name: '张三',
      job_title: '产品经理',
      pipeline_stage: 'interview',
    });
    renderPage({
      board: makeBoard({
        submitted: [submittedCard],
        screen_passed: [screenCard],
        interview: [interviewCard],
      }),
    });

    const cards = await screen.findAllByTestId('hp-kanban-card');
    expect(cards.length).toBe(3);
    expect(cards[0].getAttribute('data-stage')).toBe('submitted');
    expect(cards[0]).toHaveTextContent('张一');
    expect(cards[0]).toHaveTextContent('前端工程师');
    expect(cards[1].getAttribute('data-stage')).toBe('screen_passed');
    expect(cards[1]).toHaveTextContent('张二');
    expect(cards[2].getAttribute('data-stage')).toBe('interview');
    expect(cards[2]).toHaveTextContent('张三');

    // Column counts reflect card totals per stage.
    const counts = screen.getAllByTestId('hp-kanban-column-count');
    expect(counts[0]).toHaveTextContent('1');
    expect(counts[1]).toHaveTextContent('1');
    expect(counts[2]).toHaveTextContent('1');
    expect(counts[3]).toHaveTextContent('0');
    expect(counts[4]).toHaveTextContent('0');
  });

  it('falls back to (匿名) when a card has no candidate_name and renders match score when present', async () => {
    renderPage({
      board: makeBoard({
        submitted: [
          makeCard({
            recommendation_id: 'rec-anon',
            candidate_name: null,
            match_score: 0.72,
          }),
          makeCard({
            recommendation_id: 'rec-no-score',
            candidate_name: '李四',
            match_score: null,
          }),
        ],
      }),
    });

    const cards = await screen.findAllByTestId('hp-kanban-card');
    expect(cards[0]).toHaveTextContent('(匿名)');
    expect(cards[0]).toHaveTextContent('匹配 72%');
    expect(cards[1]).toHaveTextContent('李四');
    expect(cards[1]).not.toHaveTextContent('匹配');
  });

  it('renders an empty board with a placeholder per column when no cards exist', async () => {
    renderPage({ board: makeBoard() });
    const empties = await screen.findAllByTestId('hp-kanban-column-empty');
    expect(empties.length).toBe(6);
    empties.forEach((e) => {
      expect(e).toHaveTextContent('暂无卡片');
    });
    expect(screen.queryByTestId('hp-kanban-card')).toBeNull();
  });

  it('dragging a card to a legal next-stage column calls kanban.move() with the target column id', async () => {
    const submittedCard = makeCard({
      recommendation_id: 'rec-move',
      pipeline_stage: 'submitted',
    });
    renderPage({
      board: makeBoard({ submitted: [submittedCard] }),
      moveResolve: {
        ...submittedCard,
        pipeline_stage: 'screen_passed',
        kanban_position: 0,
      },
    });

    const card = await screen.findByTestId('hp-kanban-card');
    const columns = screen.getAllByTestId('hp-kanban-column');
    // submitted (id=1) → screen_passed (id=2): legal per state machine.
    const targetColumn = columns[1];
    expect(targetColumn.getAttribute('data-stage')).toBe('screen_passed');

    dragCardToColumn(card, targetColumn);

    await waitFor(() => {
      expect(mockedMove).toHaveBeenCalledWith({
        recommendation_id: 'rec-move',
        to_column_id: 2,
      });
    });
    expect(mockedMove).toHaveBeenCalledTimes(1);
  });

  it('dragging a card to an illegal next-stage column shows a toast and does NOT call kanban.move()', async () => {
    const submittedCard = makeCard({
      recommendation_id: 'rec-illegal',
      pipeline_stage: 'submitted',
    });
    renderPage({
      board: makeBoard({ submitted: [submittedCard] }),
    });

    const card = await screen.findByTestId('hp-kanban-card');
    const columns = screen.getAllByTestId('hp-kanban-column');
    // submitted → onboarded: NOT in the state machine.
    const targetColumn = columns[4];
    expect(targetColumn.getAttribute('data-stage')).toBe('onboarded');

    dragCardToColumn(card, targetColumn);

    await waitFor(() => {
      expect(screen.getByTestId('hp-kanban-toast')).toBeInTheDocument();
    });
    const toast = screen.getByTestId('hp-kanban-toast');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast).toHaveTextContent('无法从');
    expect(toast).toHaveTextContent('submitted');
    expect(toast).toHaveTextContent('onboarded');

    // Client-side pre-validation blocks the mutation entirely.
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it('dragging a card back to a non-adjacent earlier column (illegal) is blocked client-side', async () => {
    // interview → submitted is NOT a legal transition.
    const interviewCard = makeCard({
      recommendation_id: 'rec-backwards',
      pipeline_stage: 'interview',
    });
    renderPage({
      board: makeBoard({ interview: [interviewCard] }),
    });

    const card = await screen.findByTestId('hp-kanban-card');
    const columns = screen.getAllByTestId('hp-kanban-column');
    const submittedColumn = columns[0];
    expect(submittedColumn.getAttribute('data-stage')).toBe('submitted');

    dragCardToColumn(card, submittedColumn);

    await waitFor(() => {
      expect(screen.getByTestId('hp-kanban-toast')).toBeInTheDocument();
    });
    expect(mockedMove).not.toHaveBeenCalled();
  });

  it('dragging a card to the same column (reorder) calls move() WITHOUT triggering the state-machine check', async () => {
    const cardA = makeCard({
      recommendation_id: 'rec-A',
      pipeline_stage: 'submitted',
    });
    const cardB = makeCard({
      recommendation_id: 'rec-B',
      pipeline_stage: 'submitted',
    });
    renderPage({
      board: makeBoard({ submitted: [cardA, cardB] }),
      moveResolve: { ...cardA, kanban_position: 1 },
    });

    const cards = await screen.findAllByTestId('hp-kanban-card');
    const submittedColumn = screen.getAllByTestId('hp-kanban-column')[0];
    expect(submittedColumn.getAttribute('data-stage')).toBe('submitted');

    // Drop card A back into the same submitted column (reorder).
    dragCardToColumn(cards[0], submittedColumn);

    await waitFor(() => {
      expect(mockedMove).toHaveBeenCalledWith({
        recommendation_id: 'rec-A',
        to_column_id: 1,
      });
    });
    // No toast should appear for same-column reorders.
    expect(screen.queryByTestId('hp-kanban-toast')).toBeNull();
  });

  it('invalidates the kanban query cache after a successful move', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const submittedCard = makeCard({
      recommendation_id: 'rec-success',
      pipeline_stage: 'submitted',
    });

    mockedGet
      .mockResolvedValueOnce(makeBoard({ submitted: [submittedCard] }))
      .mockResolvedValueOnce(
        makeBoard({ screen_passed: [{ ...submittedCard, pipeline_stage: 'screen_passed' }] }),
      );
    mockedMove.mockResolvedValueOnce({ ...submittedCard, pipeline_stage: 'screen_passed' });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/hunter/kanban']}>
          <KanbanPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId('hp-kanban-card');
    const columns = screen.getAllByTestId('hp-kanban-column');
    dragCardToColumn(card, columns[1]); // submitted → screen_passed

    await waitFor(() => {
      expect(mockedMove).toHaveBeenCalledWith({
        recommendation_id: 'rec-success',
        to_column_id: 2,
      });
    });

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey).filter(Boolean);
      const flat = keys.flat() as string[];
      expect(flat).toContain('kanban');
    });
  });

  it('shows a toast when the server rejects the move with a 409-style error', async () => {
    const submittedCard = makeCard({
      recommendation_id: 'rec-server-reject',
      pipeline_stage: 'submitted',
    });
    renderPage({
      board: makeBoard({ submitted: [submittedCard] }),
      moveReject: new Error('非法转换：submitted → onboarded 不允许'),
    });

    const card = await screen.findByTestId('hp-kanban-card');
    const columns = screen.getAllByTestId('hp-kanban-column');
    // Force the call through by going through a legal transition; the
    // server still rejects (simulating a stale client or race).
    dragCardToColumn(card, columns[1]); // submitted → screen_passed (legal client-side)

    await waitFor(() => {
      expect(mockedMove).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const toast = screen.getByTestId('hp-kanban-toast');
      expect(toast).toHaveTextContent('无法移动');
      expect(toast).toHaveTextContent('非法转换');
      expect(toast.getAttribute('role')).toBe('alert');
    });
  });

  it('renders the error state when the kanban query rejects', async () => {
    renderPage({ boardReject: new Error('网络异常') });
    const err = await screen.findByTestId('hp-kanban-error');
    expect(err).toHaveTextContent('加载失败');
    expect(err).toHaveTextContent('网络异常');
    expect(screen.queryByTestId('hp-kanban-board')).toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});