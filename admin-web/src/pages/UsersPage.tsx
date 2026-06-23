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

  const load = (p: number, keyword?: string) => {
    setLoading(true);
    listUsers({ page: p, pageSize: 20, keyword })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page); }, [page]);

  const columns: Column<UserRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.id}</code> },
    { key: 'name', header: 'Name', render: r => r.name },
    { key: 'type', header: 'Role', render: r => r.user_type },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'quota', header: 'Quota', render: r => `${r.quota_used}/${r.quota_per_day}` },
    { key: 'created', header: 'Created', render: r => relativeTime(r.created_at) },
  ];

  const filters: Filter[] = [
    { label: 'Role', value: 'user_type', options: [
      { label: 'Candidate', value: 'candidate' },
      { label: 'Headhunter', value: 'headhunter' },
      { label: 'Employer', value: 'employer' },
    ] },
    { label: 'Status', value: 'status', options: [
      { label: 'Active', value: 'active' },
      { label: 'Suspended', value: 'suspended' },
      { label: 'Deleted', value: 'deleted' },
    ] },
  ];

  return (
    <Layout adminName="Admin">
      <h1>Users</h1>
      <SearchBar
        placeholder="Search name..."
        filters={filters}
        onSearch={(kw) => { setPage(1); load(1, kw); }}
      />
      <Table<UserRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="No users found"
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