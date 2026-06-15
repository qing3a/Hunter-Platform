import { useState } from 'react';

export default function App(): JSX.Element {
  const [reply, setReply] = useState<string>('');
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Convo</h1>
      <p>AI desktop client — bootstrapped.</p>
      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setReply(await window.api.ping());
            } catch (err) {
              setReply(`error: ${(err as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'pinging…' : 'ping'}
        </button>
        <span data-testid="reply">reply: {reply || '(none)'}</span>
      </div>
    </div>
  );
}
