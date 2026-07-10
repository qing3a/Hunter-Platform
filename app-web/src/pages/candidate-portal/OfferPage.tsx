import { useQuery, useMutation } from '@tanstack/react-query';
import { applications } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function OfferPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications', 'offers'],
    queryFn: async () => {
      const all = await applications.list(50);
      return all.filter((a: any) => ['employer_interested', 'considering_offer', 'candidate_approved'].includes(a.recommendation_status));
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: any }) => applications.respond(id, action),
    onSuccess: () => window.location.reload(),
  });

  return (
    <MobileLayout title="收到的 offer">
      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.length === 0 && <EmptyState icon="🎁" title="还没有 offer" description="继续申请心仪的工作吧" />}
      {(data ?? []).map((a: any) => (
        <div key={a.id} className="cp-offer-card">
          <h3>{a.job_title}</h3>
          <p>{a.job_industry}</p>
          <p>状态: {a.recommendation_status}</p>
          {a.recommendation_status === 'employer_interested' && (
            <div className="cp-app-actions">
              <button className="cp-btn-primary" onClick={() => respondMutation.mutate({ id: a.id, action: 'accept_offer' })}>接受</button>
              <button className="cp-btn-secondary" onClick={() => respondMutation.mutate({ id: a.id, action: 'decline_offer' })}>拒绝</button>
            </div>
          )}
        </div>
      ))}
    </MobileLayout>
  );
}
