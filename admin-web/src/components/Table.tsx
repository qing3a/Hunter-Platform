import React from 'react';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
};

export default function Table<T>({
  columns,
  rows,
  loading = false,
  empty = 'No data',
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty?: string;
}) {
  if (loading) return <div className="card">Loading...</div>;
  if (rows.length === 0) return <div className="card">{empty}</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f5f5f5' }}>
          {columns.map(c => (
            <th key={c.key} style={{ textAlign: 'left', padding: '12px 8px', borderBottom: '1px solid #e0e0e0' }}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
            {columns.map(c => (
              <td key={c.key} style={{ padding: '12px 8px' }}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}