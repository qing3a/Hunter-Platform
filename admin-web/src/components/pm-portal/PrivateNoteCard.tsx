// ============================================================================
// PrivateNoteCard (S5 / Task 13)
// ============================================================================
//
// PM-private note editor for a single candidate.
//
//   ┌──────────────────────────────────────────┐
//   │ PM 私有笔记       [⭐] [✏️ 编辑]        │  <- header + actions
//   │ ───────────────────────────────────────  │
//   │  已联系, 等回复                          │  <- note text (or empty state)
//   │  周二已微信, 下周三内推               │     (when note_text = '')
//   │                                          │
//   │ [edit mode → textarea + Save / Cancel]    │
//   └──────────────────────────────────────────┘
//
// Data flow
// ---------
//   - read:   useQuery(['pm', 'notes', candidateUserId], () => pmNotes.get(id))
//   - write:  useMutation pmNotes.update()
//
// For Task 13 this is the *UI surface* — the actual persistence endpoint
// ships in Task 16 (PM Notes CRUD). The hooks read/write through the
// `pmNotes` namespace added in src/api/pm-portal.ts. Until Task 16 lands,
// the GET endpoint returns a 404 and we degrade to a clean empty state
// (the UI does not block on the network — the editor still opens).
//
// Star button (⭐)
// ----------------
// Independent of "edit mode": the PM can star/unstar without opening
// the editor. The star toggles immediately on click; the call is a
// fire-and-forget PUT that flips the boolean — the displayed star
// optimistically reflects the new state, then reconciles on mutation
// success via onSuccess invalidation.

import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  pmNotes,
  type UpdatePmPrivateNoteInput,
} from '../../api/pm-portal';
import { useToast } from '../../lib/toast';

interface PrivateNoteCardProps {
  /** candidate_user_id this note is bound to. */
  candidateUserId: string;
  /**
   * Optional override for the displayed fallback name (used in toasts
   * to confirm "saved note for 张*三"). When omitted the toast just
   * says "已保存".
   */
  candidateLabel?: string;
}

// ============================================================================
// Component
// ============================================================================

export function PrivateNoteCard({ candidateUserId, candidateLabel }: PrivateNoteCardProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  // ---- Local UI state ----
  const [isEditing, setIsEditing] = useState(false);
  /** Draft text while editing. Initialised from the loaded note. */
  const [draftText, setDraftText] = useState('');
  /**
   * Optimistic star — when the PM clicks ⭐ we flip immediately so the
   * UI feels responsive; the mutation onSuccess reconciles with the
   * server's authoritative boolean.
   */
  const [optimisticStarred, setOptimisticStarred] = useState<boolean | null>(null);

  // ---- Network: read ----
  const queryKey = ['pm', 'notes', candidateUserId];
  const noteQuery = useQuery({
    queryKey,
    queryFn: () => pmNotes.get(candidateUserId),
    enabled: Boolean(candidateUserId),
    retry: false,
  });

  // Hydrate the draft text from the loaded note whenever it changes.
  useEffect(() => {
    if (noteQuery.data) {
      setDraftText(noteQuery.data.note_text ?? '');
    }
  }, [noteQuery.data]);

  // ---- Network: write (star + text share one mutation helper) ----
  const updateMutation = useMutation({
    mutationFn: (input: UpdatePmPrivateNoteInput) =>
      pmNotes.update(candidateUserId, input),
    onSuccess: (saved) => {
      // Reconcile the cache with whatever the server echoed back.
      queryClient.setQueryData(queryKey, saved);
      // Reset the optimistic-star override — server has spoken.
      setOptimisticStarred(null);
      setIsEditing(false);
      const label = candidateLabel ? ` · ${candidateLabel}` : '';
      toast.push({
        type: 'success',
        message: `笔记已保存${label}`,
      });
    },
    onError: (err: Error) => {
      // Roll back the optimistic star so the UI doesn't lie.
      setOptimisticStarred(null);
      toast.push({
        type: 'error',
        message: `保存失败:${err.message ?? '未知错误'}`,
      });
    },
  });

  // ---- Derived ----
  const storedStarred = noteQuery.data?.starred ?? false;
  const isStarred = optimisticStarred ?? storedStarred;
  const noteText = noteQuery.data?.note_text ?? '';

  // ---- Handlers ----

  const handleEdit = () => {
    if (noteQuery.data) {
      setDraftText(noteQuery.data.note_text ?? '');
    } else {
      setDraftText('');
    }
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setDraftText(noteText);
  };

  const handleSave = () => {
    const trimmed = draftText.trim();
    updateMutation.mutate({ note_text: trimmed });
  };

  const handleToggleStar = () => {
    const next = !isStarred;
    setOptimisticStarred(next);
    updateMutation.mutate({ starred: next });
  };

  // ---- Render ----

  return (
    <section
      className="pm-private-note"
      data-testid="pm-private-note"
      data-candidate-user-id={candidateUserId}
      data-starred={isStarred ? 'true' : 'false'}
      aria-label="PM 私有笔记"
    >
      <header className="pm-private-note-header">
        <h2 className="pm-private-note-title">PM 私有笔记</h2>
        <div className="pm-private-note-actions">
          <button
            type="button"
            className="pm-private-note-star"
            data-testid="pm-private-note-star"
            onClick={handleToggleStar}
            disabled={updateMutation.isPending}
            aria-pressed={isStarred}
            title={isStarred ? '取消关注' : '关注候选人'}
          >
            <span aria-hidden="true" className="pm-private-note-star-glyph">
              {isStarred ? '★' : '☆'}
            </span>
            <span className="pm-private-note-star-label">
              {isStarred ? '已关注' : '关注'}
            </span>
          </button>
          {!isEditing && (
            <button
              type="button"
              className="pm-private-note-edit"
              data-testid="pm-private-note-edit"
              onClick={handleEdit}
            >
              编辑
            </button>
          )}
        </div>
      </header>

      {isEditing ? (
        <div className="pm-private-note-editor" data-testid="pm-private-note-editor">
          <textarea
            className="pm-private-note-textarea"
            data-testid="pm-private-note-textarea"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="例如: 已联系 · 等回复 / 周二已微信, 下周三内推"
            rows={5}
            maxLength={2000}
          />
          <div className="pm-private-note-meta">
            <span
              className="pm-private-note-counter"
              data-testid="pm-private-note-counter"
              data-count={draftText.length}
            >
              {draftText.length} / 2000
            </span>
            <div className="pm-private-note-buttons">
              <button
                type="button"
                className="pm-private-note-cancel"
                data-testid="pm-private-note-cancel"
                onClick={handleCancel}
                disabled={updateMutation.isPending}
              >
                取消
              </button>
              <button
                type="button"
                className="pm-private-note-save"
                data-testid="pm-private-note-save"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="pm-private-note-display" data-testid="pm-private-note-display">
          {noteQuery.isError ? (
            <p className="pm-private-note-error" data-testid="pm-private-note-error">
              加载笔记失败:{String((noteQuery.error as Error)?.message ?? '未知错误')}
            </p>
          ) : noteQuery.isLoading ? (
            <p className="pm-private-note-loading" data-testid="pm-private-note-loading">
              加载中…
            </p>
          ) : noteText.trim().length === 0 ? (
            <p className="pm-private-note-empty" data-testid="pm-private-note-empty">
              暂无笔记 · 点击编辑记录沟通进展
            </p>
          ) : (
            <p
              className="pm-private-note-text"
              data-testid="pm-private-note-text"
            >
              {noteText}
            </p>
          )}
        </div>
      )}

      {updateMutation.isError && !isEditing && (
        <p className="pm-private-note-error" data-testid="pm-private-note-error">
          保存失败:{String((updateMutation.error as Error)?.message ?? '未知错误')}
        </p>
      )}
    </section>
  );
}
