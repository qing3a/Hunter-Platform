// ============================================================================
// ActionStack (Task 11 / S6)
// ============================================================================
//
// Three per-row action buttons that sit at the foot of every S6
// MatchCard. Order is significant:
//
//   1. → 推荐给猎头   (primary)   — hand the candidate to a real headhunter
//   2. 📞 解锁        (secondary) — pay / unlock full contact details
//   3. ✗ 不合适      (danger-sm)  — dismiss the candidate from this funnel
//
// The component is a pure presentational widget — it doesn't know what
// "recommend" or "reject" actually do, it just forwards the click to
// the parent (which wires the real handler, e.g. a toast placeholder
// for v1 or a mutation in a later Task).
//
// Why three separate props instead of one `onAction(kind)` handler?
//   - Type-safe at the call site (no stringly-typed dispatch).
//   - Easy to make any subset optional in a future Task without changing
//     the signature shape.

interface ActionStackProps {
  onRecommend: () => void;
  onUnlock: () => void;
  onReject: () => void;
}

export function ActionStack({ onRecommend, onUnlock, onReject }: ActionStackProps) {
  return (
    <div className="pm-action-stack" data-testid="pm-action-stack">
      <button
        type="button"
        className="pm-btn-primary pm-action-stack-btn"
        onClick={onRecommend}
        data-testid="pm-action-recommend"
      >
        → 推荐给猎头
      </button>
      <button
        type="button"
        className="pm-btn-secondary pm-action-stack-btn"
        onClick={onUnlock}
        data-testid="pm-action-unlock"
      >
        📞 解锁
      </button>
      <button
        type="button"
        className="pm-btn-danger-sm pm-action-stack-btn"
        onClick={onReject}
        data-testid="pm-action-reject"
      >
        ✗ 不合适
      </button>
    </div>
  );
}
