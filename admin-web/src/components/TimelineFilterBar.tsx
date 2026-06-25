type Source = 'all' | 'admin' | 'user' | 'unlock';

type TimelineFilterBarProps = {
  source: Source;
  onSourceChange: (s: Source) => void;
  from: string;
  onFromChange: (v: string) => void;
  until: string;
  onUntilChange: (v: string) => void;
  actor: string;
  onActorChange: (v: string) => void;
  onClear: () => void;
};

export default function TimelineFilterBar(props: TimelineFilterBarProps) {
  const { source, onSourceChange, from, onFromChange, until, onUntilChange, actor, onActorChange, onClear } = props;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      <select
        value={source}
        onChange={e => onSourceChange(e.target.value as Source)}
        data-testid="timeline-source-filter"
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
      >
        <option value="all">来源:全部</option>
        <option value="admin">来源:admin</option>
        <option value="user">来源:user</option>
        <option value="unlock">来源:unlock</option>
      </select>
      <label>
        从{' '}
        <input
          type="date"
          value={from.slice(0, 10)}
          onChange={e => onFromChange(e.target.value ? e.target.value + 'T00:00:00Z' : '')}
          data-testid="timeline-from"
          style={{ padding: 4 }}
        />
      </label>
      <label>
        至{' '}
        <input
          type="date"
          value={until.slice(0, 10)}
          onChange={e => onUntilChange(e.target.value ? e.target.value + 'T23:59:59Z' : '')}
          data-testid="timeline-until"
          style={{ padding: 4 }}
        />
      </label>
      <input
        type="text"
        placeholder="操作人搜索..."
        value={actor}
        onChange={e => onActorChange(e.target.value)}
        data-testid="timeline-actor"
        style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4, width: 200 }}
      />
      <button onClick={onClear} className="btn" data-testid="timeline-clear">
        清除
      </button>
    </div>
  );
}