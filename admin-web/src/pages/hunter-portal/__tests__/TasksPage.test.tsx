import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TasksPage } from '../TasksPage';
import {
  tasks,
  type HunterTask,
} from '../../../api/hunter-portal';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/hunter-portal', () => ({
  tasks: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
  },
}));

const mockedList = vi.mocked(tasks.list);
const mockedCreate = vi.mocked(tasks.create);
const mockedUpdate = vi.mocked(tasks.update);
const mockedDelete = vi.mocked(tasks.delete);
const mockedComplete = vi.mocked(tasks.complete);
const mockedReopen = vi.mocked(tasks.reopen);

// Stub window.confirm globally so delete confirmations don't block tests.
beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

// ---- Fixture --------------------------------------------------------------

function makeTask(overrides: Partial<HunterTask> = {}): HunterTask {
  return {
    id: 't-default',
    hunter_user_id: 'h-1',
    title: 'Default task',
    description: null,
    related_recommendation_id: null,
    related_candidate_user_id: null,
    due_at: null,
    completed_at: null,
    priority: 'normal',
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

// ---- Helpers --------------------------------------------------------------

interface RenderOpts {
  pending?: HunterTask[];
  completed?: HunterTask[];
  listReject?: Error;
}

function renderPage(opts: RenderOpts = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  if (opts.listReject) {
    // Both pending and completed queries reject.
    mockedList.mockRejectedValue(opts.listReject);
  } else {
    mockedList.mockImplementation((input: { status?: string } = {}) => {
      if (input.status === 'completed') {
        return Promise.resolve(opts.completed ?? []);
      }
      return Promise.resolve(opts.pending ?? []);
    });
  }

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/hunter/tasks']}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ----------------------------------------------------------------

describe('TasksPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the loading state while the tasks query is pending', async () => {
    mockedList.mockReturnValueOnce(new Promise<HunterTask[]>(() => {}));
    renderPage();
    expect(await screen.findByTestId('hp-tasks-loading')).toHaveTextContent('加载中');
    expect(screen.queryByTestId('hp-tasks-list')).toBeNull();
    expect(mockedList).toHaveBeenCalled();
  });

  it('renders the pending tasks list on first load with the pending tab active', async () => {
    renderPage({
      pending: [
        makeTask({ id: 'p1', title: '联系张*谈 offer', priority: 'high' }),
        makeTask({ id: 'p2', title: '审核简历' }),
      ],
    });

    await screen.findByTestId('hp-tasks-list');
    const rows = screen.getAllByTestId('hp-tasks-row');
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveTextContent('联系张*谈 offer');
    expect(rows[0].getAttribute('data-completed')).toBe('false');
    expect(rows[0].getAttribute('data-task-id')).toBe('p1');

    // Both rows carry a priority badge.
    const priorities = screen.getAllByTestId('hp-tasks-priority').map(
      (el) => el.getAttribute('data-priority'),
    );
    expect(priorities).toEqual(['high', 'normal']);

    // Pending tab is active by default.
    expect(screen.getByTestId('hp-task-tab-pending').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('hp-task-tab-completed').getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the empty state for the pending tab when there are no pending tasks', async () => {
    renderPage({ pending: [] });
    expect(await screen.findByText('暂无待办任务')).toBeInTheDocument();
    expect(screen.queryByTestId('hp-tasks-list')).toBeNull();
  });

  it('switches to the completed tab and re-queries with status="completed"', async () => {
    renderPage({
      pending: [makeTask({ id: 'p1', title: 'pending task' })],
      completed: [makeTask({
        id: 'c1',
        title: '已完成的联系',
        completed_at: Date.UTC(2026, 6, 1, 10),
        priority: 'urgent',
      })],
    });

    await screen.findByTestId('hp-tasks-list');
    expect(mockedList).toHaveBeenLastCalledWith({ status: 'pending' });

    fireEvent.click(screen.getByTestId('hp-task-tab-completed'));

    await waitFor(() => {
      expect(mockedList).toHaveBeenLastCalledWith({ status: 'completed' });
    });
    const rows = await screen.findAllByTestId('hp-tasks-row');
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveTextContent('已完成的联系');
    expect(rows[0].getAttribute('data-completed')).toBe('true');
    // Completed rows hide the complete button and show reopen instead.
    expect(screen.getByTestId('hp-tasks-reopen')).toBeInTheDocument();
    expect(screen.queryByTestId('hp-tasks-complete')).toBeNull();
  });

  it('renders the empty state for the completed tab when there are no completed tasks', async () => {
    renderPage({
      pending: [makeTask({ id: 'p1' })],
      completed: [],
    });

    await screen.findByTestId('hp-tasks-list');
    fireEvent.click(screen.getByTestId('hp-task-tab-completed'));
    expect(await screen.findByText('暂无已完成任务')).toBeInTheDocument();
    expect(screen.queryByTestId('hp-tasks-list')).toBeNull();
  });

  it('submits the add-task form and calls tasks.create with the typed values', async () => {
    mockedCreate.mockResolvedValueOnce(
      makeTask({ id: 'new-1', title: '新任务', priority: 'high' }),
    );
    renderPage({ pending: [] });

    await screen.findByText('暂无待办任务');
    fireEvent.click(screen.getByTestId('hp-task-add-toggle'));

    const form = await screen.findByTestId('hp-task-add-form');
    const titleInput = screen.getByTestId('hp-task-input-title') as HTMLInputElement;
    const descInput = screen.getByTestId('hp-task-input-description') as HTMLTextAreaElement;
    const priorityInput = screen.getByTestId('hp-task-input-priority') as HTMLSelectElement;

    fireEvent.change(titleInput, { target: { value: '新任务' } });
    fireEvent.change(descInput, { target: { value: '详细描述' } });
    fireEvent.change(priorityInput, { target: { value: 'high' } });
    expect(titleInput.value).toBe('新任务');
    expect(priorityInput.value).toBe('high');

    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({
        title: '新任务',
        description: '详细描述',
        priority: 'high',
      });
    });
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('omits description from create() when the textarea is left blank', async () => {
    mockedCreate.mockResolvedValueOnce(makeTask({ id: 'new-2', title: 'no desc' }));
    renderPage({ pending: [] });

    await screen.findByText('暂无待办任务');
    fireEvent.click(screen.getByTestId('hp-task-add-toggle'));
    const form = await screen.findByTestId('hp-task-add-form');

    fireEvent.change(screen.getByTestId('hp-task-input-title'), {
      target: { value: 'no desc' },
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith({
        title: 'no desc',
        description: undefined,
        priority: 'normal',
      });
    });
  });

  it('marks a task complete via the ✓ button and re-queries the pending list', async () => {
    mockedComplete.mockResolvedValueOnce(
      makeTask({ id: 'p-x', title: 'pending only', completed_at: Date.UTC(2026, 6, 1, 10) }),
    );

    renderPage({ pending: [makeTask({ id: 'p-x', title: 'pending only' })] });

    await screen.findByTestId('hp-tasks-list');
    fireEvent.click(screen.getByTestId('hp-tasks-complete'));

    await waitFor(() => {
      expect(mockedComplete).toHaveBeenCalledWith('p-x');
    });
    expect(mockedComplete).toHaveBeenCalledTimes(1);

    // The completion mutation invalidates `['hunter', 'tasks']` which
    // re-queries both pending and completed. Switch to the completed tab
    // to assert the refetch is keyed on `status: 'completed'`.
    fireEvent.click(screen.getByTestId('hp-task-tab-completed'));
    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith({ status: 'completed' });
    });
  });

  it('reopens a completed task via the ↺ button and refetches the pending tab', async () => {
    mockedReopen.mockResolvedValueOnce(
      makeTask({ id: 'c-r', title: '重新打开', completed_at: null }),
    );

    renderPage({
      pending: [],
      completed: [makeTask({
        id: 'c-r',
        title: '重新打开',
        completed_at: Date.UTC(2026, 6, 1, 10),
      })],
    });

    await screen.findByTestId('hp-task-tab-completed');
    fireEvent.click(screen.getByTestId('hp-task-tab-completed'));
    const reopenBtn = await screen.findByTestId('hp-tasks-reopen');
    fireEvent.click(reopenBtn);

    await waitFor(() => {
      expect(mockedReopen).toHaveBeenCalledWith('c-r');
    });
  });

  it('deletes a task after confirmation and the row disappears', async () => {
    mockedDelete.mockResolvedValueOnce({ deleted: true });
    renderPage({
      pending: [
        makeTask({ id: 'd-1', title: '要删除的' }),
        makeTask({ id: 'd-2', title: '保留' }),
      ],
    });

    await screen.findByTestId('hp-tasks-list');
    const initialRows = screen.getAllByTestId('hp-tasks-row');
    expect(initialRows.length).toBe(2);

    const deleteButtons = screen.getAllByTestId('hp-tasks-delete');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockedDelete).toHaveBeenCalledWith('d-1');
    });
  });

  it('does not delete when the user cancels the confirmation dialog', async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    renderPage({
      pending: [makeTask({ id: 'd-no', title: '保留' })],
    });

    await screen.findByTestId('hp-tasks-list');
    fireEvent.click(screen.getByTestId('hp-tasks-delete'));
    // The mutation is NOT called when the user cancels.
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('renders the error state when the list query rejects', async () => {
    renderPage({ listReject: new Error('网络异常') });
    const err = await screen.findByTestId('hp-tasks-error');
    expect(err).toHaveTextContent('加载失败');
    expect(err).toHaveTextContent('网络异常');
    expect(screen.queryByTestId('hp-tasks-list')).toBeNull();
  });

  it('loads an existing task into the form when the ✎ edit button is pressed', async () => {
    mockedUpdate.mockResolvedValueOnce(makeTask({ id: 'edit-1', title: '新标题', priority: 'urgent' }));
    renderPage({
      pending: [makeTask({
        id: 'edit-1',
        title: '原标题',
        description: '原描述',
        priority: 'low',
      })],
    });

    await screen.findByTestId('hp-tasks-list');
    fireEvent.click(screen.getByTestId('hp-tasks-edit'));

    const titleInput = await screen.findByTestId('hp-task-input-title');
    expect((titleInput as HTMLInputElement).value).toBe('原标题');
    expect((screen.getByTestId('hp-task-input-description') as HTMLTextAreaElement).value).toBe('原描述');
    expect((screen.getByTestId('hp-task-input-priority') as HTMLSelectElement).value).toBe('low');

    fireEvent.change(titleInput, { target: { value: '新标题' } });
    fireEvent.change(screen.getByTestId('hp-task-input-priority'), { target: { value: 'urgent' } });
    fireEvent.submit(screen.getByTestId('hp-task-add-form'));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith('edit-1', {
        title: '新标题',
        description: '原描述',
        priority: 'urgent',
      });
    });
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
