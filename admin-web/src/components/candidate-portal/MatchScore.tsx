interface MatchScoreProps { score: number; }

export function MatchScore({ score }: MatchScoreProps) {
  const color = score >= 80 ? 'var(--c-position)'
              : score >= 50 ? 'var(--c-candidate)'
              : 'var(--text-muted)';
  return (
    <span className="cp-match-score" style={{ background: color }} title={`匹配度 ${score}/100`}>
      {score}
    </span>
  );
}