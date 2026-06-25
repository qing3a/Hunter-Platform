import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import DetailDrawer from '../components/DetailDrawer';
import CsvButton from '../components/CsvButton';
import Skeleton from '../components/Skeleton';
import { relativeTime } from '../lib/format';
import { listJobs, type JobRow, type JobStatus } from '../api/jobs';

const statusFilters: Filter[] = [
  { label: '状态', value: 'status', options: [
    { label: '开放', value: 'open' },
    { label: '已认领', value: 'claimed' },
    { label: '暂停', value: 'paused' },
    { label: '已关闭', value: 'closed' },
    { label: '已招到', value: 'filled' },
  ] },
];

export default function JobsPage() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');
  const [detail, setDetail] = useState<{ open: boolean; data: unknown; title: string }>({
    open: false, data: null, title: '',
  });

  const load = (p: number, kw: string, status: JobStatus | '') => {
    setLoading(true);
    listJobs({ page: p, pageSize: 20, keyword: kw || undefined, status: status || undefined })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, keyword, statusFilter); }, [page, keyword, statusFilter]);

  const columns: Column<JobRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'employer', header: '雇主', render: r => r.employer_name },
    { key: 'title', header: '职位', render: r => r.title },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.status} /> },
    { key: 'timeline', header: '时间轴', render: r => (
      <span>
        <Link to={`/admin/jobs/${r.id}`} className="btn btn-sm" data-testid={`detail-link-${r.id}`}>详情</Link>{' '}
        <Link to={`/admin/jobs/${r.id}/timeline`} className="btn btn-sm" data-testid={`timeline-link-${r.id}`}>时间轴</Link>
      </span>
    ) },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
    { key: 'actions', header: '操作', render: r => (
      <button onClick={() => setDetail({ open: true, data: r, title: `Job ${r.id}` })} className="btn btn-sm">
        详情
      </button>
    ) },
  ];

  return (
    <Layout adminName="Admin">
      <h1>职位</h1>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <SearchBar
          placeholder="搜索职位标题/雇主..."
          filters={statusFilters}
          onSearch={(kw, filters) => {
            setPage(1);
            setKeyword(kw);
            setStatusFilter((filters.status as JobStatus) || '');
          }}
        />
        <CsvButton
          filename={`jobs-${new Date().toISOString().slice(0, 10)}`}
          rows={rows}
          columns={[
            { key: 'id', header: 'ID' },
            { key: 'employer_name', header: '雇主' },
            { key: 'title', header: '职位' },
            { key: 'status', header: '状态' },
            { key: 'created_at', header: '创建时间' },
          ]}
        />
      </div>
      {loading ? (
        <Skeleton variant="row" count={5} />
      ) : (
        <Table<JobRow> columns={columns} rows={rows} loading={false} empty="未找到职位" />
      )}
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
      <DetailDrawer
        open={detail.open}
        title={detail.title}
        data={detail.data}
        onClose={() => setDetail({ open: false, data: null, title: '' })}
      />
    </Layout>
  );
}