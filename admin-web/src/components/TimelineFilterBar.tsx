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

const CONTROL_HEIGHT = 32;
const CONTROL_STYLE = {
  height: CONTROL_HEIGHT,
  padding: '0 8px',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box' as const,
};

const LABEL_STYLE = {
  display: 'block',
  fontSize: 12,
  color: '#666',
  marginBottom: 4,
};

export default function TimelineFilterBar(props: TimelineFilterBarProps) {
  const { source, onSourceChange, from, onFromChange, until, onUntilChange, actor, onActorChange, onClear } = props;
  return (
    <div
      style={{
        background: '#fafafa',
        border: '1px solid #e0e0e0',
        borderRadius: 4,
        padding: 16,
        marginBottom: 16,
        display: 'flex',
        gap: 16,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <label style={LABEL_STYLE} htmlFor="timeline-source-filter">来源</label>
        <select
          id="timeline-source-filter"
          value={source}
          onChange={e => onSourceChange(e.target.value as Source)}
          data-testid="timeline-source-filter"
          style={{ ...CONTROL_STYLE, width: 130 }}
        >
          <option value="all">全部</option>
          <option value="admin">admin</option>
          <option value="user">user</option>
          <option value="unlock">unlock</option>
        </select>
      </div>

      <div>
        <label style={LABEL_STYLE} htmlFor="timeline-from">从</label>
        <input
          id="timeline-from"
          type="date"
          value={from.slice(0, 10)}
          onChange={e => onFromChange(e.target.value ? e.target.value + 'T00:00:00Z' : '')}
          data-testid="timeline-from"
          style={{ ...CONTROL_STYLE, width: 140 }}
        />
      </div>

      <div>
        <label style={LABEL_STYLE} htmlFor="timeline-until">至</label>
        <input
          id="timeline-until"
          type="date"
          value={until.slice(0, 10)}
          onChange={e => onUntilChange(e.target.value ? e.target.value + 'T23:59:59Z' : '')}
          data-testid="timeline-until"
          style={{ ...CONTROL_STYLE, width: 140 }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 200 }}>
        <label style={LABEL_STYLE} htmlFor="timeline-actor">操作人</label>
        <input
          id="timeline-actor"
          type="text"
          placeholder="搜索操作人 ID..."
          value={actor}
          onChange={e => onActorChange(e.target.value)}
          data-testid="timeline-actor"
          style={{ ...CONTROL_STYLE, width: '100%' }}
        />
      </div>

      <button
        onClick={onClear}
        data-testid="timeline-clear"
        style={{
          height: CONTROL_HEIGHT,
          padding: '0 16px',
          background: '#fff',
          border: '1px solid #ccc',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        清除
      </button>
    </div>
  );
}