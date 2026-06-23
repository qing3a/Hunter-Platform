import { useEffect, useState } from 'react';
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

  const load = (p: number, keyword?: string) => {
    setLoading(true);
    listCandidates({ page: p, pageSize: 20, keyword })
      .then(r => { setRows(r.data); setPagination(r.pagination); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(page); }, [page]);

  const columns: Column<CandidateRow>[] = [
    { key: 'id', header: 'ID', render: r => <code>{r.anonymized_id}</code> },
    { key: 'name', header: 'Name', render: r => r.masked_name },
    { key: 'email', header: 'Email', render: r => r.masked_email },
    { key: 'source', header: 'Source', render: r => <code>{r.headhunter_id}</code> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.unlock_status} /> },
    { key: 'created', header: 'Created', render: r => relativeTime(r.created_at) },
  ];

  const filters: Filter[] = [
    { label: 'Status', value: 'unlock_status', options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Unlocked', value: 'unlocked' },
      { label: 'Locked', value: 'locked' },
    ] },
  ];

  return (
    <Layout adminName="Admin">
      <h1>Candidates</h1>
      <SearchBar
        placeholder="Search name/email..."
        filters={filters}
        onSearch={(kw) => { setPage(1); load(1, kw); }}
      />
      <Table<CandidateRow>
        columns={columns}
        rows={rows}
        loading={loading}
        empty="No candidates found"
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