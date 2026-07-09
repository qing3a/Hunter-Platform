import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { applications } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { FunnelCard } from '../../components/candidate-portal/FunnelCard';

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: app, isLoading } = useQuery({
    queryKey: ['applications', id],
    queryFn: () => applications.detail(Number(id)),
    enabled: !!id,
  });

  const respondMutation = useMutation({
    mutationFn: (action: 'withdraw' | 'consider_offer' | 'accept_offer' | 'decline_offer') =>
      applications.respond(Number(id), action),
    onSuccess: () => window.location.reload(),
  });

  if (isLoading) return <MobileLayout><div className="cp-loading">加载中...</div></MobileLayout>;
  if (!app) return <MobileLayout><div>申请不存在</div></MobileLayout>;

  const stages = [
    { name: '投递', count: 1, is_current: app.recommendation_status === 'pending_pickup' },
    { name: '简历过', count: app.recommendation_status !== 'pending_pickup' ? 1 : 0, is_current: app.recommendation_status === 'pending' },
    { name: '面试', count: ['employer_interested', 'candidate_approved'].includes(app.recommendation_status) ? 1 : 0, is_current: app.recommendation_status === 'employer_interested' },
    { name: 'offer', count: app.recommendation_status === 'candidate_approved' ? 1 : 0, is_current: app.recommendation_status === 'candidate_approved' },
    { name: '到岗', count: 0 },
  ];

  return (
    <MobileLayout title="申请详情">
      <h2>{app.job_title}</h2>
      <p>状态: {app.recommendation_status}</p>
      <p>申请时间: {new Date(app.created_at).toLocaleString('zh-CN')}</p>

      <FunnelCard stages={stages} />

      {app.candidate_note && (
        <div className="cp-app-note">
          <strong>我的附言:</strong>
          <p>{app.candidate_note}</p>
        </div>
      )}

      <div className="cp-app-actions">
        {['pending_pickup', 'pending'].includes(app.recommendation_status) && (
          <button className="cp-btn-secondary" onClick={() => {
            if (confirm('确定撤回申请?')) respondMutation.mutate('withdraw');
          }} disabled={respondMutation.isPending}>
            撤回申请
          </button>
        )}
        {app.recommendation_status === 'employer_interested' && (
          <>
            <button className="cp-btn-primary" onClick={() => respondMutation.mutate('accept_offer')}>接受 offer</button>
            <button className="cp-btn-secondary" onClick={() => respondMutation.mutate('decline_offer')}>拒绝 offer</button>
          </>
        )}
      </div>
    </MobileLayout>
  );
}