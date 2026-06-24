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
      <span style={{ color: '#666' }}>显示 {start}-{end} 共 {total} 条</span>
      <div style={{ flex: 1 }} />
      <button className="btn" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>上一页</button>
      <span>第 {page} 页</span>
      <button className="btn" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>下一页</button>
    </div>
  );
}