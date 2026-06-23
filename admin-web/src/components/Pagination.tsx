export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
      <span style={{ color: '#666' }}>Showing {start}-{end} of {total}</span>
      <div style={{ flex: 1 }} />
      <button className="btn" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>← Prev</button>
      <span>Page {page}</span>
      <button className="btn" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>Next →</button>
    </div>
  );
}