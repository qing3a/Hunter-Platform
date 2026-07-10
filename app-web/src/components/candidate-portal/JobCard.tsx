import { Link } from 'react-router-dom';
import { MatchScore } from './MatchScore';

interface JobCardProps {
  job: {
    id: string;
    title: string;
    industry?: string | null;
    salary_min?: number | null;
    salary_max?: number | null;
    skills?: string[];
  };
  matchScore?: number;
}

export function JobCard({ job, matchScore }: JobCardProps) {
  const salary = job.salary_min && job.salary_max
    ? `${(job.salary_min / 1000).toFixed(0)}k-${(job.salary_max / 1000).toFixed(0)}k`
    : '面议';

  return (
    <Link to={`/candidate/jobs/${job.id}`} className="cp-job-card">
      <div className="cp-job-header">
        <div className="cp-job-title">{job.title}</div>
        {matchScore != null && <MatchScore score={matchScore} />}
      </div>
      <div className="cp-job-meta">
        {job.industry && <span className="cp-job-tag">{job.industry}</span>}
        <span className="cp-job-salary">💰 {salary}</span>
      </div>
      {job.skills && job.skills.length > 0 && (
        <div className="cp-job-skills">
          {job.skills.slice(0, 5).map(s => (
            <span key={s} className="cp-skill-tag">{s}</span>
          ))}
        </div>
      )}
    </Link>
  );
}