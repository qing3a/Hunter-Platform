import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { jobs } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { RadarChart } from '../../components/candidate-portal/RadarChart';
import { MatchScore } from '../../components/candidate-portal/MatchScore';

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [note, setNote] = useState('');

  const { data: job, isLoading } = useQuery({
    queryKey: ['jobs', id],
    queryFn: () => jobs.detail(id!),
    enabled: !!id,
  });

  const applyMutation = useMutation({
    mutationFn: () => jobs.apply(id!, note || undefined),
    onSuccess: () => navigate('/candidate/applications'),
  });

  if (isLoading) return <MobileLayout><div className="cp-loading">加载中...</div></MobileLayout>;
  if (!job) return <MobileLayout><div>工作不存在</div></MobileLayout>;

  const salary = job.salary_min && job.salary_max
    ? `${(job.salary_min / 1000).toFixed(0)}k-${(job.salary_max / 1000).toFixed(0)}k`
    : '面议';

  const radarDimensions = [
    { label: '技能', score: job.match_dimensions?.skills?.length > 0
      ? Math.min(100, job.match_dimensions.skills.filter((s: string) => job.match_dimensions.job_skills.includes(s)).length / job.match_dimensions.skills.length * 100)
      : 0 },
    { label: '经验', score: 70 },
    { label: '薪资', score: job.salary_min ? 80 : 50 },
    { label: '行业', score: 60 },
    { label: '职级', score: 75 },
  ];

  return (
    <MobileLayout title={job.title}>
      <div className="cp-job-detail">
        <div className="cp-job-detail-header">
          <div>
            <h1>{job.title}</h1>
            <div className="cp-job-meta">
              {job.industry && <span className="cp-job-tag">{job.industry}</span>}
              <span className="cp-job-salary">💰 {salary}</span>
            </div>
          </div>
          {job.match_score != null && <MatchScore score={job.match_score} />}
        </div>

        <RadarChart dimensions={radarDimensions} />

        <h2>职位描述</h2>
        <p className="cp-job-description">{job.description ?? '暂无描述'}</p>

        {job.skills && job.skills.length > 0 && (
          <>
            <h2>所需技能</h2>
            <div className="cp-job-skills">
              {job.skills.map((s: string) => <span key={s} className="cp-skill-tag">{s}</span>)}
            </div>
          </>
        )}

        <div className="cp-apply-box">
          <textarea
            placeholder="可选: 附言..."
            value={note} onChange={e => setNote(e.target.value)}
            className="cp-textarea" maxLength={500} rows={4}
          />
          <button className="cp-btn-primary" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
            {applyMutation.isPending ? '申请中...' : '立即申请'}
          </button>
          {applyMutation.error && <div className="cp-error">{(applyMutation.error as any).message}</div>}
        </div>
      </div>
    </MobileLayout>
  );
}
