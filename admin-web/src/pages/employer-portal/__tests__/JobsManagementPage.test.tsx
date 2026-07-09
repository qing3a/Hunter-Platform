import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobsManagementPage } from '../JobsManagementPage';
import { employerJobs, type Job } from '../../../api/employer';

// ---- Mocks ---------------------------------------------------------------

vi.mock('../../../api/employer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/employer')>();
  return {
    ...actual,
    employerJobs: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
      reject: vi.fn(),
    },
  };
});

const mockedList = vi.mocked(employerJobs.list);
const mockedGet = vi.mocked(employerJobs.get);
const mockedCreate = vi.mocked(employerJobs.create);
const mockedUpdate = vi.mocked(employerJobs.update);
const mockedPause = vi.mocked(employerJobs.pause);
const mockedResume = vi.mocked(employerJobs.resume);
const mockedClose = vi.mocked(employerJobs.close);

// ---- Helpers -------------------------------------------------------------

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    employer_id: 'emp-1',
    source_headhunter_id: null,
    created_for_employer_id: null,
    title: 'Senior Backend Engineer',
    description: 'Job description',
    required_skills: ['TypeScript', 'Node.js'],
    salary_min: 50000,
    salary_max: 80000,
    status: 'open',
    priority: 'normal',
    deadline: null,
    industry: '互联网',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/employer/jobs']}>
        <JobsManagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests ---------------------------------------------------------------

describe('JobsManagementPage — loading / error', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state while the list request is in flight', () => {
    mockedList.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('employer-jobs-loading')).toBeInTheDocument();
  });

  it('renders an error banner when employerJobs.list rejects', async () => {
    mockedList.mockRejectedValueOnce(new Error('加载失败'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-jobs-error')).toHaveTextContent('加载失败');
  });
});

describe('JobsManagementPage — header + empty state', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page header with title and new-job button', async () => {
    mockedList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-jobs-title')).toHaveTextContent('工作管理');
    expect(screen.getByTestId('employer-jobs-new')).toBeInTheDocument();
  });

  it('shows an empty state when the job list is empty', async () => {
    mockedList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-empty')).toBeInTheDocument();
    });
  });
});

describe('JobsManagementPage — stats + table', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the 3 stat tiles with correct counts', async () => {
    mockedList.mockResolvedValue([
      makeJob({ id: 'a', status: 'open' }),
      makeJob({ id: 'b', status: 'open' }),
      makeJob({ id: 'c', status: 'paused' }),
      makeJob({ id: 'd', status: 'closed' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('employer-jobs-stat-total')).toHaveTextContent('4');
    expect(screen.getByTestId('employer-jobs-stat-open')).toHaveTextContent('2');
    expect(screen.getByTestId('employer-jobs-stat-paused')).toHaveTextContent('1');
  });

  it('renders a row per job in the table', async () => {
    mockedList.mockResolvedValue([
      makeJob({ id: 'a', title: 'Job A' }),
      makeJob({ id: 'b', title: 'Job B' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-jobs-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-row-b')).toBeInTheDocument();
  });

  it('renders status labels in the status column (open/paused/closed/filled)', async () => {
    mockedList.mockResolvedValue([
      makeJob({ id: 'a', status: 'open' }),
      makeJob({ id: 'b', status: 'paused' }),
      makeJob({ id: 'c', status: 'closed' }),
      makeJob({ id: 'd', status: 'filled' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-status')).toHaveTextContent('开放');
    expect(within(screen.getByTestId('employer-jobs-row-b')).getByTestId('employer-jobs-status')).toHaveTextContent('暂停');
    expect(within(screen.getByTestId('employer-jobs-row-c')).getByTestId('employer-jobs-status')).toHaveTextContent('关闭');
    expect(within(screen.getByTestId('employer-jobs-row-d')).getByTestId('employer-jobs-status')).toHaveTextContent('已招满');
  });

  it('exposes the right action buttons per status (open → pause+close)', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'open' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-edit')).toBeInTheDocument();
    expect(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-pause')).toBeInTheDocument();
    expect(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-close')).toBeInTheDocument();
  });

  it('exposes the right action buttons per status (paused → resume+close)', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'paused' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-resume')).toBeInTheDocument();
    expect(within(screen.getByTestId('employer-jobs-row-a')).queryByTestId('employer-jobs-action-pause')).toBeNull();
    expect(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-close')).toBeInTheDocument();
  });
});

describe('JobsManagementPage — status filter', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders all status filter buttons', async () => {
    mockedList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-jobs-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-filter-open')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-filter-paused')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-filter-closed')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-filter-filled')).toBeInTheDocument();
  });

  it('filters rows by status when a filter is clicked', async () => {
    mockedList.mockResolvedValue([
      makeJob({ id: 'a', status: 'open' }),
      makeJob({ id: 'b', status: 'paused' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    // Both rows initially visible.
    expect(screen.getByTestId('employer-jobs-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-row-b')).toBeInTheDocument();

    // Click the "paused" filter — only the paused row remains.
    fireEvent.click(screen.getByTestId('employer-jobs-filter-paused'));
    expect(screen.getByTestId('employer-jobs-row-b')).toBeInTheDocument();
    expect(screen.queryByTestId('employer-jobs-row-a')).toBeNull();
  });

  it('does NOT re-query the backend when a status filter is clicked (client-side filter)', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'open' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    const initialCallCount = mockedList.mock.calls.length;
    fireEvent.click(screen.getByTestId('employer-jobs-filter-open'));
    // Filter is purely client-side — the network call count does not change.
    expect(mockedList.mock.calls.length).toBe(initialCallCount);
  });
});

describe('JobsManagementPage — create modal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the create modal when "+ 新建工作" is clicked', async () => {
    mockedList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-jobs-new'));
    expect(screen.getByTestId('employer-jobs-modal')).toBeInTheDocument();
    expect(screen.getByTestId('employer-jobs-modal-title')).toHaveTextContent('新建工作');
  });

  it('calls employerJobs.create when the form is submitted with a valid title', async () => {
    mockedList.mockResolvedValue([]);
    mockedCreate.mockResolvedValue(makeJob({ id: 'new-id', title: 'New Job' }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-jobs-new'));

    fireEvent.change(screen.getByTestId('employer-job-form-title'), {
      target: { value: 'New Job' },
    });
    fireEvent.click(screen.getByTestId('employer-jobs-modal-submit'));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Job' }),
      );
    });
  });

  it('closes the modal after a successful create', async () => {
    mockedList.mockResolvedValue([]);
    mockedCreate.mockResolvedValue(makeJob({ id: 'new-id', title: 'New Job' }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-jobs-new'));
    fireEvent.change(screen.getByTestId('employer-job-form-title'), {
      target: { value: 'New Job' },
    });
    fireEvent.click(screen.getByTestId('employer-jobs-modal-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('employer-jobs-modal')).toBeNull();
    });
  });

  it('shows an inline error when create rejects and keeps the modal open', async () => {
    mockedList.mockResolvedValue([]);
    mockedCreate.mockRejectedValueOnce(new Error('标题非法'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-jobs-new'));
    fireEvent.change(screen.getByTestId('employer-job-form-title'), {
      target: { value: 'New Job' },
    });
    fireEvent.click(screen.getByTestId('employer-jobs-modal-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-modal-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-jobs-modal-error')).toHaveTextContent('标题非法');
    expect(screen.getByTestId('employer-jobs-modal')).toBeInTheDocument();
  });

  it('cancels / closes the modal without creating', async () => {
    mockedList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-root')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('employer-jobs-new'));
    expect(screen.getByTestId('employer-jobs-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('employer-jobs-modal-cancel'));
    expect(screen.queryByTestId('employer-jobs-modal')).toBeNull();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('JobsManagementPage — edit modal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('hydrates the modal with the existing job when 编辑 is clicked', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', title: 'Job A' })]);
    mockedGet.mockResolvedValue(makeJob({ id: 'a', title: 'Job A', description: 'desc-a' }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });

    fireEvent.click(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('employer-jobs-modal-title')).toHaveTextContent('编辑工作');
    // Form pre-fill from mocked employerJobs.get
    expect((screen.getByTestId('employer-job-form-title') as HTMLInputElement).value).toBe('Job A');
    expect(
      (screen.getByTestId('employer-job-form-description') as HTMLTextAreaElement).value,
    ).toBe('desc-a');
  });

  it('calls employerJobs.update when the edit form is submitted', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', title: 'Job A' })]);
    mockedGet.mockResolvedValue(makeJob({ id: 'a', title: 'Job A' }));
    mockedUpdate.mockResolvedValue(makeJob({ id: 'a', title: 'Renamed' }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });

    fireEvent.click(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-modal')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('employer-job-form-title'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByTestId('employer-jobs-modal-submit'));

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'Renamed' }));
    });
  });
});

describe('JobsManagementPage — pause / resume / close actions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('calls employerJobs.pause when 暂停 is clicked on an open row', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'open' })]);
    mockedPause.mockResolvedValue({ status: 'paused' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    fireEvent.click(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-pause'));

    await waitFor(() => {
      expect(mockedPause).toHaveBeenCalledWith('a');
    });
  });

  it('calls employerJobs.resume when 恢复 is clicked on a paused row', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'paused' })]);
    mockedResume.mockResolvedValue({ status: 'open' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    fireEvent.click(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-resume'));

    await waitFor(() => {
      expect(mockedResume).toHaveBeenCalledWith('a');
    });
  });

  it('calls employerJobs.close when 关闭 is clicked on an open row', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'open' })]);
    mockedClose.mockResolvedValue({ status: 'closed' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    fireEvent.click(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-close'));

    await waitFor(() => {
      expect(mockedClose).toHaveBeenCalledWith('a');
    });
  });

  it('refreshes the list after a successful pause', async () => {
    mockedList.mockResolvedValue([makeJob({ id: 'a', status: 'open' })]);
    mockedPause.mockResolvedValue({ status: 'paused' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('employer-jobs-table')).toBeInTheDocument();
    });
    const initialCallCount = mockedList.mock.calls.length;
    fireEvent.click(within(screen.getByTestId('employer-jobs-row-a')).getByTestId('employer-jobs-action-pause'));

    await waitFor(() => {
      expect(mockedPause).toHaveBeenCalledWith('a');
    });
    await waitFor(() => {
      expect(mockedList.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
