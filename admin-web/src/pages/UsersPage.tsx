import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Table, { type Column } from '../components/Table';
import Pagination from '../components/Pagination';
import SearchBar, { type Filter } from '../components/SearchBar';
import StatusBadge from '../components/StatusBadge';
import { relativeTime } from '../lib/format';
import { listUsers, type UserRow } from '../api/users';

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [userTypeFilter, setUserTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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

  useEffect(() => { load(page, undefined, userTypeFilter, statusFilter); }, [page, userTypeFilter, statusFilter]);

  const columns: Column<UserRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'name', header: '姓名', render: r => r.name },
    { key: 'type', header: '角色', render: r => r.user_type },
    { key: 'status', header: '状态', render: r => <StatusBadge status={r.status} /> },
    { key: 'quota', header: '配额', render: r => `${r.quota_used}/${r.quota_per_day}` },
    { key: 'created', header: '创建时间', render: r => relativeTime(r.created_at) },
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
    </Layout>
  );
}
