import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PickupQueuePage } from '../PickupQueuePage';
import { pickup, type PendingPickupItem, type PendingPickupPayload } from '../../../api/hunter-portal';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/hunter-portal', () => ({
  pickup: {
    listPending: vi.fn(),
    claim: vi.fn(),
  },
}));

const mockedPickup = vi.mocked(pickup);

// ---- Fixture --------------------------------------------------------------

function makeItem(overrides: Partial<PendingPickupItem> = {}): PendingPickupItem {
  return {
    id: 1,
    recommendation_id: 'rec-1',
    candidate_user_id: 'u-1',
    job_id: 'j-1',
    pickup_headhunter_id: null,
    candidate_note: null,
    withdrawn_at: null,
    created_at: Date.UTC(2026, 6, 1, 10, 0, 0),
    job_title: '前端工程师',
    candidate_display_name: '张*',
    recommendation_status: 'pending_pickup',
    ...overrides,
  };
}

function makePayload(items: PendingPickupItem[]): PendingPickupPayload {
  return { items, next_cursor: null };
}

// ---- Helpers --------------------------------------------------------------

interface RenderOpts {
  list?: PendingPickupPayload;
  listReject?: Error;
  claim?: { recommendation_id: string; status: 'pending' };
  claimReject?: Error;
}

function renderPage(opts: RenderOpts = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  if (opts.listReject) {
    mockedPickup.listPending.mockRejectedValueOnce(opts.listReject);
  } else if (opts.list) {
    mockedPickup.listPending.mockResolvedValueOnce(opts.list);
  } else {
    mockedPickup.listPending.mockReturnValueOnce(new Promise<PendingPickupPayload>(() => {}));
  }

  if (opts.claimReject) {
    mockedPickup.claim.mockRejectedValue(opts.claimReject);
  } else if (opts.claim) {
    mockedPickup.claim.mockResolvedValue(opts.claim);
  }

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/hunter/pickup']}>
        <PickupQueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('PickupQueuePage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the loading state while the query is pending', async () => {
    renderPage();
    expect(await screen.findByTestId('hp-pickup-loading')).toHaveTextContent('加载中');
    expect(screen.queryByTestId('hp-pickup-table')).toBeNull();
    expect(mockedPickup.listPending).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when the queue has zero items', async () => {
    renderPage({ list: makePayload([]) });
    expect(await screen.findByText('暂无待认领候选人')).toBeInTheDocument();
    expect(screen.queryByTestId('hp-pickup-table')).toBeNull();
  });

  it('renders the populated table with candidate, job, time, and a claim button per row', async () => {
    const items: PendingPickupItem[] = [
      makeItem({ recommendation_id: 'rec-A', candidate_display_name: '张*', job_title: '前端工程师' }),
      makeItem({
        id: 2,
        recommendation_id: 'rec-B',
        candidate_user_id: 'u-2',
        candidate_display_name: '李*',
        job_title: '后端工程师',
        candidate_note: '请尽快联系',
        created_at: Date.UTC(2026, 6, 2, 9, 0, 0),
      }),
    ];
    renderPage({ list: makePayload(items) });

    const table = await screen.findByTestId('hp-pickup-table');
    const rows = screen.getAllByTestId('hp-pickup-row');
    expect(rows.length).toBe(2);

    // First row: name + job + claim button.
    expect(rows[0]).toHaveTextContent('张*');
    expect(rows[0]).toHaveTextContent('前端工程师');
    const buttons = screen.getAllByTestId('hp-pickup-claim');
    expect(buttons.length).toBe(2);
    expect(buttons[0]).toHaveTextContent('认领');
    expect(buttons[0]).not.toBeDisabled();
    expect(rows[0].getAttribute('data-rec-id')).toBe('rec-A');

    // Second row carries the candidate note through.
    expect(rows[1]).toHaveTextContent('李*');
    expect(rows[1]).toHaveTextContent('后端工程师');
    expect(rows[1]).toHaveTextContent('请尽快联系');
    expect(table).toBeInTheDocument();
  });

  it('falls back to (匿名) for anonymous candidates and "-" for missing job title', async () => {
    renderPage({
      list: makePayload([
        makeItem({
          recommendation_id: 'rec-anon',
          candidate_display_name: null,
          job_title: null,
        }),
      ]),
    });

    const rows = await screen.findAllByTestId('hp-pickup-row');
    expect(rows[0]).toHaveTextContent('(匿名)');
    expect(rows[0]).toHaveTextContent('-');
  });

  it('renders the error state when the list query rejects', async () => {
    renderPage({ listReject: new Error('网络异常') });

    const err = await screen.findByTestId('hp-pickup-error');
    expect(err).toHaveTextContent('加载失败');
    expect(err).toHaveTextContent('网络异常');
    expect(screen.queryByTestId('hp-pickup-table')).toBeNull();
    expect(mockedPickup.listPending).toHaveBeenCalledTimes(1);
  });

  it('invokes pickup.claim with the clicked row id when the claim button is pressed', async () => {
    renderPage({
      list: makePayload([
        makeItem({ recommendation_id: 'rec-X' }),
        makeItem({ id: 99, recommendation_id: 'rec-Y', candidate_display_name: '李*' }),
      ]),
      claim: { recommendation_id: 'rec-X', status: 'pending' },
    });

    await screen.findByTestId('hp-pickup-table');
    const buttons = screen.getAllByTestId('hp-pickup-claim');
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(mockedPickup.claim).toHaveBeenCalledWith('rec-Y');
    });
    expect(mockedPickup.claim).toHaveBeenCalledTimes(1);
  });

  it('invalidates the pickup + dashboard query cache after a successful claim', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    mockedPickup.listPending
      .mockResolvedValueOnce(makePayload([makeItem({ recommendation_id: 'rec-Z' })]))
      .mockResolvedValueOnce(makePayload([]));
    mockedPickup.claim.mockResolvedValueOnce({ recommendation_id: 'rec-Z', status: 'pending' });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/hunter/pickup']}>
          <PickupQueuePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByTestId('hp-pickup-table');
    fireEvent.click(screen.getByTestId('hp-pickup-claim'));

    await waitFor(() => {
      expect(mockedPickup.claim).toHaveBeenCalledWith('rec-Z');
    });

    // Expect at least the pickup + dashboard (and kanban) keys to be invalidated.
    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey).filter(Boolean);
    const flat = keys.flat() as string[];
    expect(flat).toContain('pickup');
    expect(flat).toContain('dashboard');
  });

  it('keeps the filter inputs controlled and renders the empty state when keyword excludes everything', async () => {
    renderPage({
      list: makePayload([
        makeItem({ recommendation_id: 'rec-A', candidate_display_name: '张*', job_title: '前端工程师' }),
        makeItem({
          id: 2,
          recommendation_id: 'rec-B',
          candidate_display_name: '李*',
          job_title: '后端工程师',
        }),
      ]),
    });

    await screen.findByTestId('hp-pickup-table');

    const input = screen.getByTestId('hp-pickup-keyword') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '后端' } });
    expect(input.value).toBe('后端');

    // Only the back-end row remains.
    await waitFor(() => {
      const rows = screen.queryAllByTestId('hp-pickup-row');
      expect(rows.length).toBe(1);
    });
    expect(screen.getByTestId('hp-pickup-row')).toHaveTextContent('李*');

    // Now type something that excludes both rows → empty state.
    fireEvent.change(input, { target: { value: '不存在的关键词xyz' } });
    await waitFor(() => {
      expect(screen.queryByTestId('hp-pickup-table')).toBeNull();
    });
    expect(screen.getByText('暂无待认领候选人')).toBeInTheDocument();

    // Industry select is also controlled; change has no observable effect on
    // the row set today (the backend has no industry column yet) but the
    // value should still update so the UI affordance stays coherent.
    const select = screen.getByTestId('hp-pickup-industry') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '互联网' } });
    expect(select.value).toBe('互联网');
  });

  it('disables all claim buttons while a claim mutation is pending', async () => {
    let resolveClaim!: (v: { recommendation_id: string; status: 'pending' }) => void;
    mockedPickup.listPending.mockResolvedValueOnce(
      makePayload([
        makeItem({ recommendation_id: 'rec-A' }),
        makeItem({ id: 2, recommendation_id: 'rec-B', candidate_display_name: '李*' }),
      ]),
    );
    mockedPickup.claim.mockImplementationOnce(
      () => new Promise((resolve) => { resolveClaim = resolve; }),
    );

    renderPage();

    await screen.findByTestId('hp-pickup-table');
    const buttons = screen.getAllByTestId('hp-pickup-claim');

    // Click first button — starts the mutation; both should disable until it resolves.
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(buttons[0]).toBeDisabled();
      expect(buttons[1]).toBeDisabled();
    });
    expect(buttons[0]).toHaveTextContent('认领中...');

    // Resolve to settle the mutation and avoid leaking the open promise.
    resolveClaim({ recommendation_id: 'rec-A', status: 'pending' });
    await waitFor(() => {
      expect(mockedPickup.claim).toHaveBeenCalledWith('rec-A');
    });
  });

  it('surfaces a claim-level error slot when the mutation rejects', async () => {
    mockedPickup.listPending.mockResolvedValueOnce(
      makePayload([makeItem({ recommendation_id: 'rec-err' })]),
    );
    mockedPickup.claim.mockRejectedValueOnce(new Error('已被其他猎头认领'));

    renderPage();

    await screen.findByTestId('hp-pickup-table');
    fireEvent.click(screen.getByTestId('hp-pickup-claim'));

    const errSlot = await screen.findByTestId('hp-pickup-claim-error');
    expect(errSlot).toHaveTextContent('认领失败');
    expect(errSlot).toHaveTextContent('已被其他猎头认领');
  });
});
