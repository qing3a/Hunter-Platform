import { useEffect, useState } from 'react';

export default function ConfigCenter(): JSX.Element {
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const res = await window.api.admin.config.get();
    if (res.ok) setConfig(res.data);
    else setError(res.error?.message ?? 'load failed');
  };

  useEffect(() => { void load(); }, []);

  const save = async (key: string, currentValue: any) => {
    const json = prompt(`Edit ${key} (JSON):`, JSON.stringify(currentValue, null, 2));
    if (!json) return;
    try {
      const parsed = JSON.parse(json);
      const res = await window.api.admin.config.set(key, parsed);
      if (res.ok) await load();
      else setError(res.error?.message ?? 'save failed');
    } catch (e: any) {
      setError('Invalid JSON: ' + e.message);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>配置中心</h1>
      {error && <div className="error">{error}</div>}
      <button onClick={load}>刷新</button>
      {config && Object.entries(config).map(([key, value]) => (
        <div key={key} className="card">
          <h2>{key}.json</h2>
          <pre style={{ fontSize: 12, background: '#f1f5f9', padding: 12, borderRadius: 4, overflow: 'auto' }}>
            {JSON.stringify(value, null, 2)}
          </pre>
          <button onClick={() => save(key, value)}>编辑 (JSON)</button>
        </div>
      ))}
    </div>
  );
}