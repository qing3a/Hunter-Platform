import { useEffect, useMemo, useState } from 'react';
import {
  pmDecompose,
  TITLE_LEVEL_LABELS,
  type DecomposedPosition,
  type TitleLevel,
} from '../../api/pm-portal';

// ============================================================================
// AIDecomposeModal (S2 / Task 6)
// ============================================================================
//
// Three-step flow used by ProjectDetailPage:
//   1.  Open the modal → POST /decompose (800ms simulated AI delay).
//   2.  Show the returned suggestions in an editable preview (title / skills
//       / headcount). The PM can correct the AI before committing.
//   3.  On "确认创建" → POST /commit → onClose() and let the parent refresh
//       its positions list.
//
// The component owns three local pieces of state:
//   - `phase`:     'loading' | 'preview' | 'committing' | 'error'
//   - `errorMsg`:  surfaced when the API rejects (loading phase) or the
//                  commit rejects (committing phase). Cleared on retry.
//   - `items`:     working copy of the suggestions; the PM edits them in
//                  place. On commit we POST this array.
//
// Backdrop click is a no-op while loading/committing (would race the
// network call). Cancel is the only way out during those phases.
//
// All input/output goes through testable data-testids so the
// ProjectDetailPage + AIDecomposeModal tests can drive interactions
// without scraping text.

type Phase = 'loading' | 'preview' | 'committing' | 'error';

interface AIDecomposeModalProps {
  projectId: string;
  /** Called when the modal wants to close (backdrop / cancel / after commit). */
  onClose: () => void;
  /** Called after a successful commit so the parent can re-fetch positions. */
  onCommitted?: () => void;
}

export function AIDecomposeModal({ projectId, onClose, onCommitted }: AIDecomposeModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [items, setItems] = useState<DecomposedPosition[]>([]);
  const [decompositionId, setDecompositionId] = useState<string>('');
  const [sourceText, setSourceText] = useState<string>('');

  // Kick off the decompose call on mount. We deliberately don't depend on
  // anything else — the modal opens with a fresh fetch every time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { decomposition, suggestions } = await pmDecompose.decompose(projectId);
        if (cancelled) return;
        setDecompositionId(decomposition.id);
        setSourceText(decomposition.source_text);
        setItems(suggestions);
        setPhase('preview');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg((e as Error).message || '调用失败');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Local input handlers — kept as named callbacks so the test file can
  // drive them via fireEvent.
  function updateTitle(index: number, value: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, title: value } : it)));
  }
  function updateLevel(index: number, value: TitleLevel) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, title_level: value } : it)));
  }
  function updateSkills(index: number, value: string) {
    // Skills are stored as an array of trimmed non-empty strings.
    const list = value.split(',').map((s) => s.trim()).filter(Boolean);
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, skills: list } : it)));
  }
  function updateHeadcount(index: number, value: number) {
    const safe = Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, headcount: safe } : it)));
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const canCommit = useMemo(
    () => items.length > 0 && items.every((it) => it.title.trim().length > 0 && it.headcount >= 1),
    [items],
  );

  async function onConfirm() {
    if (!canCommit) return;
    setPhase('committing');
    setErrorMsg('');
    try {
      await pmDecompose.commit(projectId, decompositionId, items);
      onCommitted?.();
      onClose();
    } catch (e) {
      setErrorMsg((e as Error).message || '创建失败');
      setPhase('preview');
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const busy = phase === 'loading' || phase === 'committing';

  return (
    <div
      className="pm-modal-backdrop"
      data-testid="pm-decompose-modal"
      onClick={() => { if (!busy) onClose(); }}
      role="presentation"
    >
      <div
        className="pm-modal pm-decompose-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-decompose-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pm-decompose-modal-header">
          <h2 id="pm-decompose-modal-title" className="pm-decompose-modal-title">
            ✨ 智能拆岗位
          </h2>
          <button
            type="button"
            className="pm-btn-link pm-decompose-modal-close"
            data-testid="pm-decompose-modal-close"
            onClick={() => { if (!busy) onClose(); }}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        {phase === 'loading' && (
          <div className="pm-decompose-loading" data-testid="pm-decompose-loading">
            <div className="pm-decompose-spinner" aria-hidden="true" />
            <p>AI 正在分析项目目标并生成岗位建议…</p>
            <p className="pm-decompose-loading-hint">首次分析约需 1 秒</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="pm-decompose-error" data-testid="pm-decompose-error" role="alert">
            <p>加载失败：{errorMsg}</p>
            <button
              type="button"
              className="pm-btn-primary"
              onClick={() => {
                // Retry: re-mount the modal by closing + parent reopens,
                // OR just kick off the call again by reloading state.
                setPhase('loading');
                setErrorMsg('');
                (async () => {
                  try {
                    const { decomposition, suggestions } = await pmDecompose.decompose(projectId);
                    setDecompositionId(decomposition.id);
                    setSourceText(decomposition.source_text);
                    setItems(suggestions);
                    setPhase('preview');
                  } catch (e) {
                    setErrorMsg((e as Error).message || '调用失败');
                    setPhase('error');
                  }
                })();
              }}
              data-testid="pm-decompose-retry"
            >
              重试
            </button>
          </div>
        )}

        {(phase === 'preview' || phase === 'committing') && (
          <>
            <section className="pm-decompose-source" data-testid="pm-decompose-source">
              <h3>分析目标</h3>
              <p className="pm-decompose-source-text">{sourceText || '(项目目标为空)'}</p>
              <p className="pm-decompose-source-hint">
                共 {items.length} 个建议岗位 — 可在下方编辑后再创建
              </p>
            </section>

            <section className="pm-decompose-list" data-testid="pm-decompose-list">
              {items.length === 0 ? (
                <p className="pm-decompose-empty">没有建议岗位。取消后请调整项目目标再试。</p>
              ) : (
                items.map((item, i) => (
                  <article
                    key={i}
                    className="pm-decompose-item"
                    data-testid="pm-decompose-item"
                    data-item-index={i}
                  >
                    <div className="pm-decompose-item-main">
                      <label className="pm-decompose-field">
                        <span>标题</span>
                        <input
                          type="text"
                          className="pm-input"
                          value={item.title}
                          onChange={(e) => updateTitle(i, e.target.value)}
                          disabled={phase === 'committing'}
                          data-testid="pm-decompose-item-title"
                          aria-label={`建议岗位 ${i + 1} 标题`}
                        />
                      </label>
                      <label className="pm-decompose-field pm-decompose-field-inline">
                        <span>级别</span>
                        <select
                          className="pm-select"
                          value={item.title_level}
                          onChange={(e) => updateLevel(i, e.target.value as TitleLevel)}
                          disabled={phase === 'committing'}
                          data-testid="pm-decompose-item-level"
                          aria-label={`建议岗位 ${i + 1} 级别`}
                        >
                          {(Object.entries(TITLE_LEVEL_LABELS) as Array<[TitleLevel, string]>).map(
                            ([k, label]) => (
                              <option key={k} value={k}>{label}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label className="pm-decompose-field pm-decompose-field-inline">
                        <span>HC</span>
                        <input
                          type="number"
                          className="pm-input pm-decompose-headcount-input"
                          value={item.headcount}
                          min={1}
                          onChange={(e) => updateHeadcount(i, Number(e.target.value))}
                          disabled={phase === 'committing'}
                          data-testid="pm-decompose-item-headcount"
                          aria-label={`建议岗位 ${i + 1} 计划人数`}
                        />
                      </label>
                      <label className="pm-decompose-field pm-decompose-field-full">
                        <span>技能（逗号分隔）</span>
                        <input
                          type="text"
                          className="pm-input"
                          value={item.skills.join(', ')}
                          onChange={(e) => updateSkills(i, e.target.value)}
                          disabled={phase === 'committing'}
                          data-testid="pm-decompose-item-skills"
                          aria-label={`建议岗位 ${i + 1} 技能`}
                        />
                      </label>
                    </div>
                    <div className="pm-decompose-item-meta">
                      <p className="pm-decompose-rationale" data-testid="pm-decompose-item-rationale">
                        💡 {item.rationale}
                      </p>
                      <button
                        type="button"
                        className="pm-btn-link pm-decompose-remove"
                        onClick={() => removeItem(i)}
                        disabled={phase === 'committing'}
                        data-testid="pm-decompose-item-remove"
                        aria-label={`删除建议岗位 ${i + 1}`}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>

            {errorMsg && (
              <p className="pm-decompose-error-msg" role="alert" data-testid="pm-decompose-commit-error">
                创建失败：{errorMsg}
              </p>
            )}

            <footer className="pm-decompose-modal-footer">
              <button
                type="button"
                className="pm-btn-secondary"
                onClick={onClose}
                disabled={busy}
                data-testid="pm-decompose-cancel"
              >
                取消
              </button>
              <button
                type="button"
                className="pm-btn-primary"
                onClick={onConfirm}
                disabled={!canCommit || busy}
                data-testid="pm-decompose-confirm"
              >
                {phase === 'committing' ? '创建中…' : '确认创建'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
