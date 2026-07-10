import { useEffect, useState } from 'react';
import { useUrlParam } from '../hooks/useUrlParam';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import DetailDrawer from '../components/DetailDrawer';
import CsvButton from '../components/CsvButton';
import Skeleton from '../components/Skeleton';
import { relativeTime } from '@hunter-platform/shared-web/lib';
import { listRecommendations, type RecommendationRow, type RecommendationStatus } from '../api/recommendations';

const statusFilters: Filter[] = [
  { label: '状态', value: 'status', options: [
    { label: '待处理', value: 'pending' },
    { label: '雇主感兴趣', value: 'employer_interested' },
    { label: '候选人同意', value: 'candidate_approved' },
    { label: '已解锁', value: 'unlocked' },
    { label: '雇主拒绝', value: 'rejected_employer' },
    { label: '候选人拒绝', value: 'rejected_candidate' },
    { label: '已撤回', value: 'withdrawn' },
    { label: '已入职', value: 'placed' },
  ] },
];

export default function RecommendationsPage() {
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
  const [statusFilter, setStatusFilter] = useUrlParam<RecommendationStatus | ''>('status', '');
  const [from, setFrom] = useUrlParam<string>('from', '');
  const [until, setUntil] = useUrlParam<string>('until', '');
  const [page, setPage] = useUrlParam<number>('page', 1,
    (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
  const [detail, setDetail] = useState<{ open: boolean; data: unknown; title: string }>({
    open: false, data: null, title: '',
  });

  const load = (p: number, kw: string | undefined, status: RecommendationStatus | '' | undefined, f: string | undefined, u: string | undefined) => {
    setLoading(true);
    listRecommendations({
      page: p, pageSize: 20,
      keyword: kw || undefined,
      status: status || undefined,
      from: f || undefined,
      until: u || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, keyword || undefined, (statusFilter || undefined) as RecommendationStatus, from || undefined, until || undefined); }, [page, keyword, statusFilter, from, until]);

  const columns: Column<RecommendationRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'job', header: '职位', render: r => r.job_title },
    { key: 'candidate', header: '候选人 ID', render: r => <code>{r.anonymized_candidate_id}</code> },
    { key: 'headhunter', header: '猎头', render: r => r.headhunter_name },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.status} /> },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
    { key: 'actions', header: '操作', render: r => (
      <div style={{ display: 'flex', gap: 8 }}>
        <Link to={`/recommendations/${r.id}`} className="btn btn-sm" data-testid={`detail-link-${r.id}`}>
          详情
        </Link>
        <button onClick={() => setDetail({ open: true, data: r, title: `Recommendation ${r.id}` })} className="btn btn-sm">
          详情 JSON
        </button>
        <Link
          to={`/admin/recommendations/${r.id}/timeline`}
          className="btn btn-sm"
          data-testid={`timeline-link-${r.id}`}
        >
          时间轴
        </Link>
      </div>
    ) },
  ];

  return (
    <Layout adminName="Admin">
      <h1>推荐</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchBar
            placeholder="搜索职位/猎头..."
            filters={statusFilters}
            onSearch={(kw, filters) => {
              setKeyword(kw);
              setPage(1);
              setStatusFilter((filters.status as RecommendationStatus) || '');
              load(1, kw, (filters.status as RecommendationStatus) || '', '', '');
            }}
          />
          <CsvButton
            filename={`recommendations-${new Date().toISOString().slice(0, 10)}`}
            rows={rows}
            columns={[
              { key: 'id', header: 'ID' },
              { key: 'job_title', header: '职位' },
              { key: 'anonymized_candidate_id', header: '候选人ID' },
              { key: 'headhunter_name', header: '猎头' },
              { key: 'status', header: '状态' },
              { key: 'created_at', header: '创建时间' },
            ]}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>从 <input type="date" value={from.slice(0, 10)} onChange={e => setFrom(e.target.value ? e.target.value + 'T00:00:00Z' : '')} style={{ padding: 4 }} /></label>
          <label>至 <input type="date" value={until.slice(0, 10)} onChange={e => setUntil(e.target.value ? e.target.value + 'T23:59:59Z' : '')} style={{ padding: 4 }} /></label>
          {(from || until) && (
            <button onClick={() => { setFrom(''); setUntil(''); }} className="btn btn-sm">清除</button>
          )}
        </div>
      </div>
      {loading ? (
        <Skeleton variant="row" count={5} />
      ) : (
        <Table<RecommendationRow> columns={columns} rows={rows} loading={false} empty="未找到推荐" />
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