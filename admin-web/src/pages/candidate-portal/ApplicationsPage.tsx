import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { applications } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_pickup: { label: '等待猎头认领', color: 'var(--c-candidate)' },
  pending: { label: '待雇主查看', color: 'var(--c-project)' },
  employer_interested: { label: '雇主感兴趣', color: 'var(--c-match)' },
  candidate_approved: { label: '已解锁', color: 'var(--c-position)' },
  considering_offer: { label: '考虑中', color: 'var(--c-candidate)' },
  rejected_employer: { label: '雇主拒绝', color: 'var(--text-muted)' },
  rejected_candidate: { label: '候选人拒绝', color: 'var(--text-muted)' },
  withdrawn: { label: '已撤回', color: 'var(--text-muted)' },
};

export function ApplicationsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: () => applications.list(50),
  });

  return (
    <MobileLayout title="我的申请">
      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.length === 0 && <EmptyState icon="📋" title="还没有申请" description="去浏览工作并申请吧" />}
      <div className="cp-app-list">
        {(data ?? []).map((a: any) => {
          const status = STATUS_LABELS[a.recommendation_status] ?? { label: a.recommendation_status, color: 'var(--text-muted)' };
          return (
            <Link key={a.id} to={`/candidate/applications/${a.id}`} className="cp-app-card">
              <div className="cp-app-header">
                <div className="cp-app-title">{a.job_title}</div>
                <span className="cp-app-status" style={{ background: status.color }}>{status.label}</span>
              </div>
              <div className="cp-app-meta">
                {a.job_industry && <span>{a.job_industry}</span>}
                <span>{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                {a.pickup_headhunter_id && <span>✓ 已认领</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </MobileLayout>
  );
}
