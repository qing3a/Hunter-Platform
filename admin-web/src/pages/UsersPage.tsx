import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUrlParam } from '../hooks/useUrlParam';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import QuotaModal from '../components/QuotaModal';
import { relativeTime } from '../lib/format';
import { listUsers, adjustQuota, type UserRow } from '../api/users';
import { useToast } from '../lib/toast';

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useUrlParam<string>('keyword', '');
  const [userTypeFilter, setUserTypeFilter] = useUrlParam<string>('user_type', '');
  const [statusFilter, setStatusFilter] = useUrlParam<string>('status', '');
  const [page, setPage] = useUrlParam<number>('page', 1,
    (v) => v && /^\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : null);
  const toast = useToast();
  const [quotaModal, setQuotaModal] = useState<{ open: boolean; user: UserRow | null }>({
    open: false, user: null,
  });

  const load = (p: number, keyword?: string, user_type?: string, status?: string) => {
    setLoading(true);
    listUsers({
      page: p, pageSize: 20,
      keyword: keyword || undefined,
      user_type: user_type || undefined,
      status: status || undefined,
    })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page, keyword || undefined, userTypeFilter || undefined, statusFilter || undefined); }, [page, keyword, userTypeFilter, statusFilter]);

  const handleAdjustQuota = async (params: { new_quota: number; reason: string }) => {
    if (!quotaModal.user) return;
    const result = await adjustQuota(quotaModal.user.id, params.new_quota, params.reason);
    toast.push({
      type: 'success',
      message: `已调整 ${quotaModal.user.name} 配额至 ${result.new_quota}`,
    });
    load(page, keyword || undefined, userTypeFilter || undefined, statusFilter || undefined);
  };

  const columns: Column<UserRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'name', header: '姓名', render: r => r.name },
    { key: 'type', header: '角色', render: r => r.user_type },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.status} /> },
    { key: 'quota', header: '配额', render: r => `${r.quota_used}/${r.quota_per_day}` },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
    {
      key: 'actions', header: '操作',
      render: r => (
        <div style={{ display: 'flex', gap: 8 }}>
          {r.status === 'active' && (
            <button
              onClick={() => setQuotaModal({ open: true, user: r })}
              className="btn btn-sm"
              data-testid={`adjust-quota-${r.id}`}
            >
              调配额
            </button>
          )}
          <Link
            to={`/users/${r.id}`}
            className="btn btn-sm"
            data-testid={`detail-link-${r.id}`}
          >
            详情
          </Link>{' '}
          <Link
            to={`/users/${r.id}/timeline`}
            className="btn btn-sm"
            data-testid={`timeline-link-${r.id}`}
          >
            时间轴
          </Link>
        </div>
      ),
    },
  ];

  const filters: Filter[] = [
    { label: '角色', value: 'user_type', options: [
      { label: '候选人', value: 'candidate' },
      { label: '猎头', value: 'headhunter' },
      { label: '雇主', value: 'employer' },
    ] },
    { label: '状态', value: 'status', options: [
      { label: '正常', value: 'active' },
      { label: '已暂停', value: 'suspended' },
      { label: '已删除', value: 'deleted' },
    ] },
  ];

  return (
    <Layout adminName="Admin">
      <h1>用户</h1>
      <SearchBar
        placeholder="搜索姓名..."
        filters={filters}
        onSearch={(kw, f) => {
          setKeyword(kw);
          setPage(1);
          setUserTypeFilter(f.user_type || '');
          setStatusFilter(f.status || '');
          load(1, kw, f.user_type, f.status);
        }}
      />
      <Table<UserRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="未找到用户"
      />
      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        onPageChange={setPage}
      />
      <QuotaModal
        open={quotaModal.open}
        user={quotaModal.user ? {
          id: quotaModal.user.id,
          name: quotaModal.user.name,
          current_quota: quotaModal.user.quota_per_day,
        } : null}
        onClose={() => setQuotaModal({ open: false, user: null })}
        onSubmit={handleAdjustQuota}
      />
    </Layout>
  );
}
