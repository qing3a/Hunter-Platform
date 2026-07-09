import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { PipelineStageBadge } from '../../components/hunter-portal/PipelineStageBadge';
import { RadarChart } from '../../components/candidate-portal/RadarChart';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import { kanban, type PipelineStage } from '../../api/hunter-portal';

// Client-side state machine mirror (matches backend canTransition + KanbanPage).
// See KanbanPage.tsx for the full rationale.
function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  const transitions: Record<PipelineStage, PipelineStage[]> = {
    submitted: ['screen_passed', 'rejected'],
    screen_passed: ['interview', 'rejected'],
    interview: ['offer', 'rejected'],
    offer: ['onboarded', 'rejected'],
    onboarded: [],
    rejected: [],
  };
  return transitions[from]?.includes(to) ?? false;
}

const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  submitted: 'screen_passed',
  screen_passed: 'interview',
  interview: 'offer',
  offer: 'onboarded',
};

/**
 * Hunter Portal — Candidate detail page (Phase 3a / Task 16).
 *
 * Read-only summary of a single recommendation. The candidate's data is
 * resolved by scanning the kanban board for a card whose
 * `recommendation_id` matches the `:id` route param — the existing backend
 * does not expose a `/v1/headhunter/recommendations/:id` detail endpoint, so
 * we reuse the kanban payload as the source of truth (this is intentionally
 * simple per the task spec — "KEEP THIS PAGE SIMPLE").
 *
 * Header shows the desensitized candidate name + pipeline stage badge.
 * Body shows a placeholder radar chart (skills_json is not yet available on
 * the kanban payload; the radar uses constant per-stage scores so the page
 * has a meaningful visualisation even before the detail endpoint ships).
 * Actions: "推进" advances to the next legal stage; "拒绝" moves to rejected.
 */
export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'kanban'],
    queryFn: () => kanban.get(),
    enabled: !!id,
  });

  const card = useMemo(() => {
    if (!data || !id) return null;
    for (const col of data.columns) {
      const found = col.cards.find((c) => c.recommendation_id === id);
      if (found) return { card: found, column: col };
    }
    return null;
  }, [data, id]);

  const moveMutation = useMutation({
    mutationFn: (input: { to_column_id: number }) =>
      kanban.move({ recommendation_id: id!, to_column_id: input.to_column_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'kanban'] });
    },
  });

  function handleAdvance() {
    if (!card) return;
    const next = NEXT_STAGE[card.card.pipeline_stage];
    if (!next) return;
    const targetColumn = data?.columns.find((c) => c.pipeline_stage === next);
    if (!targetColumn) return;
    moveMutation.mutate({ to_column_id: targetColumn.id });
  }

  function handleReject() {
    if (!card) return;
    const targetColumn = data?.columns.find((c) => c.pipeline_stage === 'rejected');
    if (!targetColumn) return;
    moveMutation.mutate({ to_column_id: targetColumn.id });
  }

  if (isLoading) {
    return (
      <div className="hp-page">
        <HunterSidebar />
        <HunterMobileLayout title="候选人详情">
          <div className="hp-loading" data-testid="hp-detail-loading">加载中...</div>
        </HunterMobileLayout>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hp-page">
        <HunterSidebar />
        <HunterMobileLayout title="候选人详情">
          <div className="hp-error" data-testid="hp-detail-error">
            加载失败: {(error as Error).message}
          </div>
        </HunterMobileLayout>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="hp-page" data-testid="hp-page-detail">
        <HunterSidebar />
        <HunterMobileLayout title="候选人详情">
          <EmptyState
            icon="🔍"
            title="未找到候选人"
            description="该推荐记录不存在或不在你的看板中"
            action={{ label: '返回候选人列表', onClick: () => navigate('/hunter/candidates') }}
          />
        </HunterMobileLayout>
      </div>
    );
  }

  // Placeholder radar dimensions — real `skills_json` is not yet exposed on
  // the kanban card payload. We synthesise scores from `match_score` so the
  // chart reflects the same data the card shows.
  const baseScore = card.card.match_score != null ? Math.round(card.card.match_score * 100) : 60;
  const radarDimensions = [
    { label: '技能', score: baseScore },
    { label: '经验', score: Math.min(100, baseScore + 5) },
    { label: '行业', score: Math.max(0, baseScore - 5) },
    { label: '薪资', score: Math.min(100, baseScore + 10) },
    { label: '职级', score: Math.max(0, baseScore - 10) },
  ];

  const canAdvance =
    !!NEXT_STAGE[card.card.pipeline_stage] &&
    canTransition(card.card.pipeline_stage, NEXT_STAGE[card.card.pipeline_stage]!);

  return (
    <div className="hp-page" data-testid="hp-page-detail">
      <HunterSidebar />
      <HunterMobileLayout title="候选人详情">
        <header className="hp-detail-header" data-testid="hp-detail-header">
          <h1 className="hp-detail-name" data-testid="hp-detail-name">
            {card.card.candidate_name ?? '(匿名)'}
          </h1>
          <div className="hp-detail-meta">
            <PipelineStageBadge stage={card.card.pipeline_stage} />
            <span className="hp-detail-job" data-testid="hp-detail-job">
              {card.card.job_title}
            </span>
            {card.card.match_score != null && (
              <span className="hp-detail-score" data-testid="hp-detail-score">
                匹配 {Math.round(card.card.match_score * 100)}%
              </span>
            )}
          </div>
        </header>

        <section className="hp-section" data-testid="hp-detail-skills">
          <h2>能力雷达</h2>
          <RadarChart dimensions={radarDimensions} />
        </section>

        <section className="hp-section" data-testid="hp-detail-timeline">
          <h2>阶段历史</h2>
          <p className="hp-detail-timeline-placeholder">阶段变更时间线（即将上线）</p>
        </section>

        <section className="hp-section hp-detail-actions" data-testid="hp-detail-actions">
          <button
            type="button"
            className="hp-btn-primary"
            disabled={!canAdvance || moveMutation.isPending}
            onClick={handleAdvance}
            data-testid="hp-detail-advance"
          >
            {moveMutation.isPending ? '处理中...' : '推进下一阶段'}
          </button>
          <button
            type="button"
            className="hp-btn-secondary"
            disabled={card.card.pipeline_stage === 'rejected' || moveMutation.isPending}
            onClick={handleReject}
            data-testid="hp-detail-reject"
          >
            拒绝
          </button>
        </section>

        {moveMutation.isError && (
          <div className="hp-error" data-testid="hp-detail-move-error">
            操作失败: {(moveMutation.error as Error).message}
          </div>
        )}
      </HunterMobileLayout>
    </div>
  );
}
