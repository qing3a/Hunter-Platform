import { Link } from 'react-router-dom';

export interface SidebarMatch {
  matchId: number;
  positionId: string;
  positionTitle: string;
  projectName: string;
  score: number;
}

interface Props {
  positionId: string;
  matches: SidebarMatch[];
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--c-stage-match)';
  if (score >= 60) return '#94a3b8';
  return 'var(--danger, #dc2626)';
}

export function MatchSidebar({ positionId, matches }: Props) {
  return (
    <aside
      className="pm-s2-match-sidebar"
      data-testid="pm-s2-match-sidebar"
      data-position-id={positionId}
      aria-label="候选人实时匹配"
    >
      <h4 className="pm-s2-match-title">🎯 候选人实时匹配</h4>
      <p className="pm-s2-match-subtitle">按匹配度排序，可一键推进</p>
      {matches.length === 0 ? (
        <div data-testid="pm-s2-match-empty" className="pm-empty-state">暂无匹配</div>
      ) : (
        <div className="pm-s2-match-list">
          {matches.map((m) => (
            <div
              key={m.matchId}
              data-testid={`pm-s2-match-row-${m.positionId}`}
              className="pm-s2-match-row"
            >
              <span className="pm-s2-match-score" style={{ color: scoreColor(m.score) }}>{m.score}</span>
              <div className="pm-s2-match-info">
                <div className="pm-s2-match-title-row">{m.positionTitle}</div>
                <div className="pm-s2-match-project">@ {m.projectName}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Link to="/admin/pm/snapshot" className="pm-s2-match-viewall" data-testid="pm-s2-match-viewall">
        查看全部匹配 →
      </Link>
    </aside>
  );
}
