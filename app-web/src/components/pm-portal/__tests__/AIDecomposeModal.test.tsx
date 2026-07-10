import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { AIDecomposeModal } from '../AIDecomposeModal';
import {
  pmDecompose,
  type DecomposedPosition,
  type DecompositionHistoryItem,
} from '../../../api/pm-portal';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/pm-portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/pm-portal')>();
  return {
    ...actual,
    pmDecompose: {
      decompose: vi.fn(),
      commit: vi.fn(),
      history: vi.fn(),
    },
  };
});

const mockedDecompose = vi.mocked(pmDecompose.decompose);
const mockedCommit = vi.mocked(pmDecompose.commit);

beforeEach(() => {
  cleanup();
  mockedDecompose.mockReset();
  mockedCommit.mockReset();
});

// ---- Helpers --------------------------------------------------------------

function makeSuggestion(overrides: Partial<DecomposedPosition> = {}): DecomposedPosition {
  return {
    title: '高级前端工程师',
    skills: ['vue', 'typescript'],
    title_level: 'senior',
    headcount: 1,
    rationale: '匹配关键词: vue, 前端',
    ...overrides,
  };
}

function makeHistory(overrides: Partial<DecompositionHistoryItem> = {}): DecompositionHistoryItem {
  return {
    id: 'decomp-abc',
    project_id: 'proj-1',
    source_text: 'vue 前端工程师',
    positions_json: [makeSuggestion()],
    source: 'ai_heuristic',
    created_at: 1_700_000_000_000,
    ...overrides,
  };
}

function renderModal(opts: { onClose?: () => void; onCommitted?: () => void } = {}) {
  const onClose = opts.onClose ?? vi.fn();
  const onCommitted = opts.onCommitted ?? vi.fn();
  return {
    onClose,
    onCommitted,
    ...render(
      <AIDecomposeModal
        projectId="proj-1"
        onClose={onClose}
        onCommitted={onCommitted}
      />,
    ),
  };
}

// Resolve the mocked decompose immediately, so we skip the loading state
// in non-loading-specific tests.
function fastDecompose(suggestions: DecomposedPosition[]) {
  mockedDecompose.mockResolvedValue({
    decomposition: makeHistory({ positions_json: suggestions }),
    suggestions,
  });
}

// ---- Tests ----------------------------------------------------------------

describe('AIDecomposeModal', () => {
  it('renders the loading spinner while the decompose call is in flight', () => {
    // Return a promise that never resolves so we stay in loading state.
    mockedDecompose.mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.getByTestId('pm-decompose-modal')).toBeInTheDocument();
    expect(screen.getByTestId('pm-decompose-loading')).toBeInTheDocument();
  });

  it('renders the editable preview after the suggestions load', async () => {
    fastDecompose([
      makeSuggestion(),
      makeSuggestion({ title: '后端工程师', skills: ['node.js'], title_level: 'senior', headcount: 2 }),
    ]);
    renderModal();
    // Loading → preview.
    await waitFor(() => {
      expect(screen.queryByTestId('pm-decompose-loading')).toBeNull();
    });
    const list = screen.getByTestId('pm-decompose-list');
    const items = within(list).getAllByTestId('pm-decompose-item');
    expect(items.length).toBe(2);

    // First item's title input.
    expect(within(items[0]).getByTestId('pm-decompose-item-title')).toHaveValue('高级前端工程师');
    expect(within(items[0]).getByTestId('pm-decompose-item-level')).toHaveValue('senior');
    expect(within(items[0]).getByTestId('pm-decompose-item-headcount')).toHaveValue(1);
    expect(within(items[0]).getByTestId('pm-decompose-item-skills')).toHaveValue('vue, typescript');
    expect(within(items[0]).getByTestId('pm-decompose-item-rationale')).toHaveTextContent(
      'vue',
    );

    // Source text shown at the top.
    const source = screen.getByTestId('pm-decompose-source');
    expect(within(source).getByText('vue 前端工程师')).toBeInTheDocument();
  });

  it('edits the title of a suggestion inline', async () => {
    fastDecompose([makeSuggestion()]);
    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-item-title'));
    const titleInput = screen.getByTestId('pm-decompose-item-title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: '资深前端工程师 (修订)' } });
    expect(titleInput).toHaveValue('资深前端工程师 (修订)');
  });

  it('edits the headcount inline', async () => {
    fastDecompose([makeSuggestion({ headcount: 1 })]);
    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-item-headcount'));
    const input = screen.getByTestId('pm-decompose-item-headcount') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    expect(input).toHaveValue(3);
  });

  it('edits skills inline (comma-separated → array)', async () => {
    fastDecompose([makeSuggestion({ skills: ['vue', 'typescript'] })]);
    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-item-skills'));
    const input = screen.getByTestId('pm-decompose-item-skills') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'vue, typescript, pinia, vitest' } });
    expect(input).toHaveValue('vue, typescript, pinia, vitest');
  });

  it('removes a suggestion via the per-row delete button', async () => {
    fastDecompose([
      makeSuggestion({ title: 'A' }),
      makeSuggestion({ title: 'B' }),
    ]);
    renderModal();
    await waitFor(() => screen.getAllByTestId('pm-decompose-item'));
    const items = screen.getAllByTestId('pm-decompose-item');
    expect(items.length).toBe(2);
    fireEvent.click(within(items[0]).getByTestId('pm-decompose-item-remove'));
    // Only one item should remain.
    expect(screen.getAllByTestId('pm-decompose-item').length).toBe(1);
    // The remaining one should be "B".
    expect(screen.getByTestId('pm-decompose-item-title')).toHaveValue('B');
  });

  it('disables the confirm button while there are zero suggestions', async () => {
    fastDecompose([]);
    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-list'));
    const confirm = screen.getByTestId('pm-decompose-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('disables the confirm button if any title is empty', async () => {
    fastDecompose([makeSuggestion({ title: '   ' })]);
    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-item-title'));
    const titleInput = screen.getByTestId('pm-decompose-item-title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: '' } });
    const confirm = screen.getByTestId('pm-decompose-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('calls commit with the (possibly edited) positions on confirm', async () => {
    fastDecompose([
      makeSuggestion({ title: 'Original Title', skills: ['vue'], headcount: 1 }),
    ]);
    mockedCommit.mockResolvedValue({
      positions: [{
        id: 'pos-new', project_id: 'proj-1', title: 'Edited Title',
        description: null, required_skills: ['react'], title_level: 'senior',
        industry: null, salary_min: null, salary_max: null, status: 'open',
        headcount_planned: 2, headcount_filled: 0, created_at: 1,
      }],
      decomposition: makeHistory(),
    });

    const { onClose, onCommitted } = renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-item-title'));

    // Edit title + HC.
    fireEvent.change(screen.getByTestId('pm-decompose-item-title'), {
      target: { value: 'Edited Title' },
    });
    fireEvent.change(screen.getByTestId('pm-decompose-item-skills'), {
      target: { value: 'react' },
    });
    fireEvent.change(screen.getByTestId('pm-decompose-item-headcount'), {
      target: { value: '2' },
    });

    fireEvent.click(screen.getByTestId('pm-decompose-confirm'));

    await waitFor(() => {
      expect(mockedCommit).toHaveBeenCalled();
    });

    const call = mockedCommit.mock.calls[0];
    expect(call[0]).toBe('proj-1');
    expect(call[1]).toBe('decomp-abc');
    expect(call[2]).toEqual([
      expect.objectContaining({
        title: 'Edited Title',
        skills: ['react'],
        headcount: 2,
      }),
    ]);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      expect(onCommitted).toHaveBeenCalled();
    });
  });

  it('shows an error and stays in preview when commit rejects', async () => {
    fastDecompose([makeSuggestion()]);
    mockedCommit.mockRejectedValue(new Error('网络异常'));

    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-confirm'));

    fireEvent.click(screen.getByTestId('pm-decompose-confirm'));
    await waitFor(() => {
      expect(screen.getByTestId('pm-decompose-commit-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-decompose-commit-error')).toHaveTextContent('网络异常');
    // Modal still visible.
    expect(screen.getByTestId('pm-decompose-modal')).toBeInTheDocument();
  });

  it('shows a retry view when the initial decompose call fails', async () => {
    mockedDecompose.mockRejectedValueOnce(new Error('后端出错'));
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId('pm-decompose-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('pm-decompose-error')).toHaveTextContent('后端出错');
    expect(screen.getByTestId('pm-decompose-retry')).toBeInTheDocument();
  });

  it('the retry button re-issues the decompose call', async () => {
    mockedDecompose
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        decomposition: makeHistory(),
        suggestions: [makeSuggestion()],
      });
    renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-retry'));
    fireEvent.click(screen.getByTestId('pm-decompose-retry'));
    await waitFor(() => {
      expect(screen.queryByTestId('pm-decompose-error')).toBeNull();
    });
    expect(screen.getByTestId('pm-decompose-item-title')).toBeInTheDocument();
    expect(mockedDecompose).toHaveBeenCalledTimes(2);
  });

  it('closes via the × button when not busy', async () => {
    fastDecompose([makeSuggestion()]);
    const { onClose } = renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-modal-close'));
    fireEvent.click(screen.getByTestId('pm-decompose-modal-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via the cancel button when not busy', async () => {
    fastDecompose([makeSuggestion()]);
    const { onClose } = renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-cancel'));
    fireEvent.click(screen.getByTestId('pm-decompose-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT close on backdrop click while loading', async () => {
    mockedDecompose.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderModal();
    expect(screen.getByTestId('pm-decompose-loading')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pm-decompose-modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does close on backdrop click while in preview', async () => {
    fastDecompose([makeSuggestion()]);
    const { onClose } = renderModal();
    await waitFor(() => screen.getByTestId('pm-decompose-list'));
    fireEvent.click(screen.getByTestId('pm-decompose-modal'));
    expect(onClose).toHaveBeenCalled();
  });
});
