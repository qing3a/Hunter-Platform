import { useState } from 'react';

export type Filter = { label: string; value: string; options: { label: string; value: string }[] };

export default function SearchBar({
  placeholder = '搜索...',
  onSearch,
  filters = [],
}: {
  placeholder?: string;
  onSearch: (keyword: string, filterValues: Record<string, string>) => void;
  filters?: Filter[];
}) {
  const [keyword, setKeyword] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map(f => [f.value, '']))
  );

  const submit = () => onSearch(keyword, values);

  return (
    <div style={{ display: 'flex', gap: 8, margin: '16px 0', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={keyword}
        onChange={e => setKeyword(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        style={{ width: 300 }}
      />
      {filters.map(f => (
        <select
          key={f.value}
          value={values[f.value] ?? ''}
          onChange={e => setValues({ ...values, [f.value]: e.target.value })}
          style={{ padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4 }}
        >
          <option value="">{f.label}:全部</option>
          {f.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      <button className="btn" onClick={submit}>搜索</button>
    </div>
  );
}