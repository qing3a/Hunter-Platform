import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { PipelineStageBadge } from '../../components/hunter-portal/PipelineStageBadge';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import {
  recommendations,
  type PipelineStage,
  type RecommendationsListItem,
} from '../../api/hunter-portal';

const STAGES: PipelineStage[] = [
  'submitted',
  'screen_passed',
  'interview',
  'offer',
  'onboarded',
  'rejected',
];

const STAGE_LABELS: Record<PipelineStage, string> = {
  submitted: '投递',
  screen_passed: '简历过',
  interview: '面试',
  offer: 'Offer',
  onboarded: '到岗',
  rejected: '已拒绝',
};

function formatRelative(ms: number, now: number = Date.now()): string {
  if (!Number.isFinite(ms)) return '-';
  const diff = now - ms;
  if (diff < 0) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Hunter Portal — Candidate list page (Phase 3a / Task 14).
 *
 * Shows this hunter's owned recommendations as a table with name / stage /
 * job / last-active columns. Filtering happens client-side over the page
 * fetched from `/v1/headhunter/recommendations` — the backend only exposes
 * `status`, while the page UI is keyed on the new `pipeline_stage` enum.
 *
 * Row click navigates to `/hunter/candidates/:id` (the detail page that
 * ships as Task 16; it may not exist yet — the link is intentionally
 * forward-compatible).
 */
export function CandidateListPage() {
  const [stage, setStage] = useState<PipelineStage | ''>('');
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'recommendations', { stage, keyword }],
    queryFn: () =>
      recommendations.list({
        stage: stage || undefined,
        keyword: keyword || undefined,
      }),
  });

  const rows = useMemo<RecommendationsListItem[]>(() => data ?? [], [data]);

  return (
    <div className="hp-page" data-testid="hp-page-candidates">
      <HunterSidebar />
      <HunterMobileLayout title="我的候选人">
        <section className="hp-filters" data-testid="hp-candidates-filters">
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as PipelineStage | '')}
            data-testid="hp-candidates-stage"
            aria-label="阶段筛选"
          >
            <option value="">所有阶段</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <input
            type="search"
            placeholder="搜索姓名 / 工作"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            data-testid="hp-candidates-keyword"
            aria-label="关键词搜索"
          />
        </section>

        {isLoading && (
          <div className="hp-loading" data-testid="hp-candidates-loading">
            加载中...
          </div>
        )}

        {error && !isLoading && (
          <div className="hp-error" data-testid="hp-candidates-error">
            加载失败: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <EmptyState
            icon="👥"
            title="暂无候选人"
            description={
              stage || keyword
                ? '当前筛选下没有匹配的候选人'
                : '你尚未推荐任何候选人'
            }
          />
        )}

        {!isLoading && !error && rows.length > 0 && (
          <table className="hp-table" data-testid="hp-candidates-table">
            <thead>
              <tr>
                <th>候选人</th>
                <th>阶段</th>
                <th>工作</th>
                <th>最近活跃</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rec) => (
                <tr
                  key={rec.id}
                  data-testid="hp-candidates-row"
                  data-rec-id={rec.id}
                  onClick={() => navigate(`/hunter/candidates/${rec.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td data-testid="hp-candidates-name">
                    {rec.candidate_name ?? '(匿名)'}
                  </td>
                  <td>
                    <PipelineStageBadge stage={rec.pipeline_stage} size="sm" />
                  </td>
                  <td>{rec.job_title ?? '-'}</td>
                  <td>{formatRelative(rec.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </HunterMobileLayout>
    </div>
  );
}
