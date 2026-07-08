interface FunnelCardProps {
  stages: Array<{ name: string; count: number; is_current?: boolean }>;
}

export function FunnelCard({ stages }: FunnelCardProps) {
  return (
    <div className="cp-funnel">
      {stages.map((s, i) => (
        <div key={i} className={`cp-funnel-stage ${s.is_current ? 'current' : ''}`}>
          <div className="cp-funnel-name">{s.name}</div>
          <div className="cp-funnel-count">{s.count}</div>
        </div>
      ))}
    </div>
  );
}