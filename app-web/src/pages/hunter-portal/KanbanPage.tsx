import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { PipelineStageBadge } from '../../components/hunter-portal/PipelineStageBadge';
import { kanban, type KanbanCard, type KanbanColumn, type PipelineStage } from '../../api/hunter-portal';

// Client-side state machine mirror (matches backend canTransition).
// Single source of truth lives on the backend; the frontend uses this for
// pre-validation + UX. The server still re-validates and is authoritative.
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

/**
 * Hunter Portal — Kanban board page (Phase 3a / Task 15).
 *
 * Renders 5 horizontal columns (投递 / 简历过 / 面试 / Offer / 到岗) plus a
 * 6th 已拒绝 column (returned by the backend) for cards that have been
 * removed. The hunter drags a card between columns to advance a candidate
 * through the pipeline.
 *
 * Drag-and-drop uses HTML5 native events (no third-party library).
 *
 * State machine:
 *   - Client-side `canTransition()` pre-validates for UX (toast on rejection).
 *   - Server is authoritative; on 409 the UI rolls back via cache invalidate
 *     and shows an error toast.
 *
 * Responsive:
 *   - Desktop: horizontal scrollable board (≥769px).
 *   - Mobile: stacked vertical accordion (≤768px).
 */
export function KanbanPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'kanban'],
    queryFn: () => kanban.get(),
  });

  const [draggedCard, setDraggedCard] = useState<KanbanCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const moveMutation = useMutation({
    mutationFn: (input: {
      recommendation_id: string;
      to_column_id: number;
    }) => kanban.move({
      recommendation_id: input.recommendation_id,
      to_column_id: input.to_column_id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'kanban'] });
    },
    onError: (err: Error) => {
      // Rollback: re-fetch authoritative state.
      queryClient.invalidateQueries({ queryKey: ['hunter', 'kanban'] });
      showToast(`无法移动: ${err.message || '非法转换'}`);
    },
  });

  function handleDrop(targetColumn: KanbanColumn, e: React.DragEvent) {
    e.preventDefault();
    if (!draggedCard || !data) return;
    const fromStage = draggedCard.pipeline_stage;
    const toStage = targetColumn.pipeline_stage;

    // Reordering within the same column is allowed and skipped past the
    // state-machine check (the kanban.move endpoint accepts same-stage moves
    // for position changes; see Task 15 spec — "Dragging a card to the same
    // column (reorder) does NOT trigger state machine check").
    if (fromStage === toStage) {
      // Same column: still call the mutation so the server records the new
      // position, but skip client-side pre-validation.
      moveMutation.mutate({
        recommendation_id: draggedCard.recommendation_id,
        to_column_id: targetColumn.id,
      });
      setDraggedCard(null);
      return;
    }

    // Cross-column: enforce the state machine on the client.
    if (!canTransition(fromStage, toStage)) {
      showToast(`无法从 ${fromStage} 移动到 ${toStage}`);
      setDraggedCard(null);
      return;
    }

    moveMutation.mutate({
      recommendation_id: draggedCard.recommendation_id,
      to_column_id: targetColumn.id,
    });
    setDraggedCard(null);
  }

  return (
    <div className="hp-page" data-testid="hp-page-kanban">
      <HunterSidebar />
      <HunterMobileLayout title="看板">
        {isLoading && (
          <div className="hp-loading" data-testid="hp-kanban-loading">加载中...</div>
        )}

        {error && !isLoading && (
          <div className="hp-error" data-testid="hp-kanban-error">
            加载失败: {(error as Error).message}
          </div>
        )}

        {data && (
          <div className="hp-kanban-board" data-testid="hp-kanban-board">
            {data.columns.map(col => (
              <div
                key={col.id}
                className="hp-kanban-column"
                data-testid="hp-kanban-column"
                data-column-id={col.id}
                data-stage={col.pipeline_stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(col, e)}
              >
                <div className="hp-kanban-column-header">
                  <PipelineStageBadge stage={col.pipeline_stage} size="sm" />
                  <span
                    className="hp-kanban-column-count"
                    data-testid="hp-kanban-column-count"
                  >
                    {col.cards.length}
                  </span>
                </div>
                <div className="hp-kanban-column-cards">
                  {col.cards.length === 0 && (
                    <div className="hp-kanban-column-empty" data-testid="hp-kanban-column-empty">
                      暂无卡片
                    </div>
                  )}
                  {col.cards.map(card => (
                    <div
                      key={card.recommendation_id}
                      className="hp-kanban-card"
                      data-testid="hp-kanban-card"
                      data-rec-id={card.recommendation_id}
                      data-stage={card.pipeline_stage}
                      draggable
                      onDragStart={() => setDraggedCard(card)}
                      onDragEnd={() => setDraggedCard(null)}
                    >
                      <div className="hp-kanban-card-name">
                        {card.candidate_name ?? '(匿名)'}
                      </div>
                      <div className="hp-kanban-card-job">{card.job_title}</div>
                      {card.match_score != null && (
                        <div className="hp-kanban-card-score">
                          匹配 {Math.round(card.match_score * 100)}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className="hp-toast" role="alert" data-testid="hp-kanban-toast">
            {toast}
          </div>
        )}
      </HunterMobileLayout>
    </div>
  );
}