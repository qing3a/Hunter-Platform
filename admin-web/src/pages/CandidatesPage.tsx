import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import { relativeTime } from '../lib/format';
import { listCandidates, type CandidateRow } from '../api/candidates';

export default function CandidatesPage() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const load = (p: number, keyword?: string, unlock_status?: string) => {
    setLoading(true);
    listCandidates({
      page: p, pageSize: 20,
      keyword: keyword || undefined,
      unlock_status: unlock_status || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, undefined, statusFilter); }, [page, statusFilter]);

  const columns: Column<CandidateRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.anonymized_id}</code> },
    { key: 'name', header: '姓名', render: r => r.masked_name },
    { key: 'email', header: '邮箱', render: r => r.masked_email },
    { key: 'source', header: '来源', render: r => <code>{r.headhunter_id}</code> },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.unlock_status} /> },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
    { key: 'timeline', header: '时间轴', render: r => (
      <span>
        <Link to={`/admin/candidates/${r.anonymized_id}`} className="btn btn-sm" data-testid={`detail-link-${r.anonymized_id}`}>详情</Link>{' '}
        <Link to={`/admin/candidates/${r.anonymized_id}/timeline`} className="btn btn-sm" data-testid={`timeline-link-${r.anonymized_id}`}>时间轴</Link>
      </span>
    ) },
  ];

  const filters: Filter[] = [
    { label: '状态', value: 'unlock_status', options: [
      { label: '待处理', value: 'pending' },
      { label: '已解锁', value: 'unlocked' },
      { label: '已锁定', value: 'locked' },
    ] },
  ];

  return (
    <Layout adminName="Admin">
      <h1>候选人</h1>
      <SearchBar
        placeholder="搜索姓名/邮箱..."
        filters={filters}
        onSearch={(kw, f) => { setPage(1); setStatusFilter(f.unlock_status || ''); load(1, kw, f.unlock_status); }}
      />
      <Table<CandidateRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="未找到候选人"
      />
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
    </Layout>
  );
}
