import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivateNoteCard } from '../PrivateNoteCard';
import { pmNotes } from '../../../api/pm-portal';
import { ToastProvider } from '../../../lib/toast';

// ---- Mocks ----------------------------------------------------------------

vi.mock('../../../api/pm-portal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/pm-portal')>();
  return {
    ...actual,
    pmNotes: {
      get: vi.fn(),
      update: vi.fn(),
    },
  };
});

const mockedGet = vi.mocked(pmNotes.get);
const mockedUpdate = vi.mocked(pmNotes.update);

// ---- Helpers --------------------------------------------------------------

function makeNote(overrides: { starred?: boolean; note_text?: string } = {}) {
  return {
    starred: overrides.starred ?? false,
    note_text: overrides.note_text ?? '',
  };
}

function renderCard(candidateUserId = 'cand-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PrivateNoteCard candidateUserId={candidateUserId} candidateLabel={candidateUserId} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// ============================================================================
// Read mode + data attributes
// ============================================================================

describe('PrivateNoteCard — read mode + data attributes', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
    mockedUpdate.mockReset();
  });

  it('renders the loading block while the GET is in flight', () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByTestId('pm-private-note-loading')).toBeInTheDocument();
  });

  it('renders the saved text on the display block when the note exists', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ note_text: '已联系, 等回复' }));
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('pm-private-note-text')).toHaveTextContent('已联系, 等回复');
    });
  });

  it('renders the empty-state copy when the note_text is empty', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ note_text: '' }));
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('pm-private-note-empty')).toBeInTheDocument();
    });
  });

  it('exposes the candidateUserId and starred=false as data-* attrs', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ starred: false, note_text: 'hello' }));
    renderCard('cand-42');
    await waitFor(() => {
      const root = screen.getByTestId('pm-private-note');
      expect(root).toHaveAttribute('data-candidate-user-id', 'cand-42');
      expect(root).toHaveAttribute('data-starred', 'false');
    });
  });

  it('reflects starred=true via aria-pressed and the star label', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ starred: true, note_text: 'top candidate' }));
    renderCard();
    await waitFor(() => {
      const star = screen.getByTestId('pm-private-note-star');
      expect(star).toHaveAttribute('aria-pressed', 'true');
      expect(star).toHaveTextContent('已关注');
    });
  });
});

// ============================================================================
// Edit mode flow
// ============================================================================

describe('PrivateNoteCard — edit mode', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
    mockedUpdate.mockReset();
  });

  it('switches to edit mode when 编辑 is clicked and pre-fills the textarea', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ note_text: 'old draft' }));
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('pm-private-note-text')).toHaveTextContent('old draft'),
    );
    fireEvent.click(screen.getByTestId('pm-private-note-edit'));
    const textarea = screen.getByTestId('pm-private-note-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('old draft');
  });

  it('calls pmNotes.update with the trimmed text on save', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ note_text: '' }));
    mockedUpdate.mockResolvedValue({ starred: false, note_text: '已联系 · 等回复' });
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('pm-private-note-empty')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pm-private-note-edit'));
    const textarea = screen.getByTestId('pm-private-note-textarea');
    fireEvent.change(textarea, { target: { value: '  已联系 · 等回复  ' } });
    fireEvent.click(screen.getByTestId('pm-private-note-save'));
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith('cand-1', { note_text: '已联系 · 等回复' });
    });
  });

  it('discards changes when 取消 is clicked (no update call)', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ note_text: 'A' }));
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('pm-private-note-text')).toHaveTextContent('A'),
    );
    fireEvent.click(screen.getByTestId('pm-private-note-edit'));
    fireEvent.change(screen.getByTestId('pm-private-note-textarea'), {
      target: { value: 'B' },
    });
    fireEvent.click(screen.getByTestId('pm-private-note-cancel'));
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-private-note-text')).toHaveTextContent('A');
  });

  it('updates the character counter as the user types', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ note_text: '' }));
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('pm-private-note-empty')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pm-private-note-edit'));
    const counter = screen.getByTestId('pm-private-note-counter');
    expect(counter).toHaveAttribute('data-count', '0');
    fireEvent.change(screen.getByTestId('pm-private-note-textarea'), {
      target: { value: 'abcde' },
    });
    expect(screen.getByTestId('pm-private-note-counter')).toHaveAttribute('data-count', '5');
  });
});

// ============================================================================
// Star toggle
// ============================================================================

describe('PrivateNoteCard — star toggle', () => {
  beforeEach(() => {
    cleanup();
    mockedGet.mockReset();
    mockedUpdate.mockReset();
  });

  it('flips aria-pressed optimistically and dispatches a PUT with the new boolean', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ starred: false, note_text: '' }));
    mockedUpdate.mockResolvedValue({ starred: true, note_text: '' });
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('pm-private-note-empty')).toBeInTheDocument(),
    );
    const star = screen.getByTestId('pm-private-note-star');
    fireEvent.click(star);
    // Optimistic UI: star is now pressed (★).
    expect(star).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith('cand-1', { starred: true });
    });
  });

  it('rolls back the optimistic flip if pmNotes.update rejects', async () => {
    mockedGet.mockResolvedValueOnce(makeNote({ starred: false, note_text: '' }));
    mockedUpdate.mockRejectedValueOnce(new Error('网络异常'));
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('pm-private-note-empty')).toBeInTheDocument(),
    );
    const star = screen.getByTestId('pm-private-note-star');
    fireEvent.click(star);
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith('cand-1', { starred: true });
    });
    // After failure, the optimistic optimistic_starred should be cleared and
    // the server's stored value (false) should drive the UI again.
    await waitFor(() => {
      expect(star).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
