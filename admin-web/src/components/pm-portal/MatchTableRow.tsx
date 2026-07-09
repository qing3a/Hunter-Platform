// ============================================================================
// MatchTableRow (S5 / Task 10)
// ============================================================================
//
// One row in the S5 match table on the candidate detail page. Six cells:
//   1. position
//   2. project
//   3. level
//   4. score (colour-coded: ≥80 stage-match green, ≥60 slate,
//            else danger red)
//   5. reasons (✓) + gaps (⚠️ when present)
//   6. action buttons: 推荐 (primary) / 谨慎 (secondary)
//
// The component is pure — the parent wires onRecommend / onCaution to
// the appropriate mutation / side-effect handler. The page renders
// many of these inside a <table>.

interface Match {
  position: string;
  project: string;
  level: string;
  score: number;
  reasons: string;
  gaps: string;
}

interface Props {
  match: Match;
  onRecommend: () => void;
  onCaution: () => void;
}

const scoreColor = (s: number): string => {
  if (s >= 80) return 'var(--c-stage-match)';
  if (s >= 60) return '#94a3b8';
  return 'var(--danger, #dc2626)';
};

export function MatchTableRow({ match, onRecommend, onCaution }: Props) {
  return (
    <tr data-testid="pm-s5-match-row">
      <td>{match.position}</td>
      <td>{match.project}</td>
      <td>{match.level}</td>
      <td style={{ color: scoreColor(match.score), fontWeight: 700 }}>
        {match.score}
      </td>
      <td>
        <strong>✓ {match.reasons}</strong>
        {match.gaps && <em> ⚠️ {match.gaps}</em>}
      </td>
      <td>
        <button
          className="pm-btn-primary"
          onClick={onRecommend}
          data-testid="pm-s5-row-recommend"
        >
          推荐
        </button>
        <button
          className="pm-btn-secondary"
          onClick={onCaution}
          data-testid="pm-s5-row-caution"
        >
          谨慎
        </button>
      </td>
    </tr>
  );
}
