import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { jobs } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { JobCard } from '../../components/candidate-portal/JobCard';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function HomePage() {
  const navigate = useNavigate();
  const { data: recommended, isLoading } = useQuery({
    queryKey: ['jobs', 'recommended'],
    queryFn: () => jobs.recommended(20),
  });
  const { data: browse } = useQuery({
    queryKey: ['jobs', 'browse'],
    queryFn: () => jobs.browse({ limit: 50 }),
  });

  const jobsById = new Map(browse?.items?.map((j: any) => [j.id, j]) ?? []);
  const recommendedJobs = (recommended ?? []).map(r => ({
    ...(jobsById.get(r.job_id) ?? { id: r.job_id, title: '(未知)' }),
    matchScore: r.score,
  }));

  return (
    <MobileLayout title="为你推荐">
      {isLoading && <div className="cp-loading">加载中...</div>}
      {!isLoading && recommendedJobs.length === 0 && (
        <EmptyState
          icon="🎯" title="还没有推荐"
          description="完善你的简历以获得更精准的匹配"
          action={{ label: '去完善', onClick: () => navigate('/candidate/profile') }}
        />
      )}
      <div className="cp-job-list">
        {recommendedJobs.map((j: any) => <JobCard key={j.id} job={j} matchScore={j.matchScore} />)}
      </div>
    </MobileLayout>
  );
}
