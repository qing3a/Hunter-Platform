import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jobs } from '../../api/candidate-portal';
import { MobileLayout } from '../../components/candidate-portal/MobileLayout';
import { JobCard } from '../../components/candidate-portal/JobCard';
import { EmptyState } from '../../components/candidate-portal/EmptyState';

export function BrowsePage() {
  const [industry, setIndustry] = useState('');
  const [keyword, setKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['jobs', 'browse', { industry, keyword }],
    queryFn: () => jobs.browse({ industry: industry || undefined, keyword: keyword || undefined, limit: 30 }),
  });

  return (
    <MobileLayout title="浏览工作">
      <div className="cp-filters">
        <input type="search" placeholder="🔍 搜索职位" value={keyword} onChange={e => setKeyword(e.target.value)} className="cp-input" />
        <select value={industry} onChange={e => setIndustry(e.target.value)} className="cp-input">
          <option value="">所有行业</option>
          <option value="tech">互联网/技术</option>
          <option value="finance">金融</option>
          <option value="education">教育</option>
          <option value="healthcare">医疗</option>
          <option value="retail">零售</option>
        </select>
      </div>
      {isLoading && <div className="cp-loading">加载中...</div>}
      {data?.items?.length === 0 && <EmptyState icon="🔍" title="暂无匹配的工作" description="尝试调整筛选条件" />}
      <div className="cp-job-list">
        {(data?.items ?? []).map((j: any) => <JobCard key={j.id} job={j} />)}
      </div>
    </MobileLayout>
  );
}
