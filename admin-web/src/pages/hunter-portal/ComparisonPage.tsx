import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { PipelineStageBadge } from '../../components/hunter-portal/PipelineStageBadge';
import { RadarChart } from '../../components/candidate-portal/RadarChart';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import { kanban, type KanbanCard } from '../../api/hunter-portal';

const MAX_COMPARE = 3;

interface CompareSlot {
  recId: string;
}

/**
 * Hunter Portal — Candidate comparison page (Phase 3a / Task 16).
 *
 * Side-by-side comparison of 2-3 candidates. The data source is the kanban
 * board (same trick as `CandidateDetailPage` — there is no dedicated
 * `/recommendations/:id` endpoint yet).
 *
 * Selection is in-memory only: the user picks rec IDs from a dropdown, and
 * each selected card gets its own column with a radar chart + attribute
 * table. Per the spec this page stays minimal — empty state + 1/2/3
 * candidate layouts are enough; no persistence, no multi-select UI.
 */
export function ComparisonPage() {
  const [slots, setSlots] = useState<CompareSlot[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'kanban'],
    queryFn: () => kanban.get(),
  });

  // Flatten all cards across columns into a single selectable list.
  const allCards = useMemo<KanbanCard[]>(() => {
    if (!data) return [];
    return data.columns.flatMap((c) => c.cards);
  }, [data]);

  // Build a lookup so selected IDs can resolve back to full card data.
  const cardById = useMemo(() => {
    const map = new Map<string, KanbanCard>();
    for (const c of allCards) map.set(c.recommendation_id, c);
    return map;
  }, [allCards]);

  // Rec IDs already on the compare board, used to filter the dropdown.
  const selectedIds = useMemo(() => new Set(slots.map((s) => s.recId)), [slots]);

  function addSlot(recId: string) {
    if (!recId) return;
    if (slots.length >= MAX_COMPARE) return;
    if (selectedIds.has(recId)) return;
    setSlots((prev) => [...prev, { recId }]);
  }

  function removeSlot(recId: string) {
    setSlots((prev) => prev.filter((s) => s.recId !== recId));
  }

  function buildRadar(card: KanbanCard) {
    const base = card.match_score != null ? Math.round(card.match_score * 100) : 60;
    return [
      { label: '技能', score: base },
      { label: '经验', score: Math.min(100, base + 5) },
      { label: '行业', score: Math.max(0, base - 5) },
      { label: '薪资', score: Math.min(100, base + 10) },
      { label: '职级', score: Math.max(0, base - 10) },
    ];
  }

  // Candidates available to add: everyone except those already selected.
  const availableCards = useMemo(
    () => allCards.filter((c) => !selectedIds.has(c.recommendation_id)),
    [allCards, selectedIds],
  );

  return (
    <div className="hp-page" data-testid="hp-page-compare">
      <HunterSidebar />
      <HunterMobileLayout title="候选人对比">
        {isLoading && (
          <div className="hp-loading" data-testid="hp-compare-loading">加载中...</div>
        )}

        {error && !isLoading && (
          <div className="hp-error" data-testid="hp-compare-error">
            加载失败: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && (
          <>
            <div className="hp-compare-picker" data-testid="hp-compare-picker">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addSlot(e.target.value);
                    e.target.value = '';
                  }
                }}
                disabled={slots.length >= MAX_COMPARE || availableCards.length === 0}
                data-testid="hp-compare-select"
                aria-label="添加候选人到对比"
              >
                <option value="">
                  {slots.length >= MAX_COMPARE
                    ? `最多 ${MAX_COMPARE} 位`
                    : availableCards.length === 0
                      ? '没有可添加的候选人'
                      : '添加候选人到对比...'}
                </option>
                {availableCards.map((c) => (
                  <option key={c.recommendation_id} value={c.recommendation_id}>
                    {c.candidate_name ?? '(匿名)'} — {c.job_title}
                  </option>
                ))}
              </select>
              <span className="hp-task-tab-count" data-testid="hp-compare-count">
                {slots.length} / {MAX_COMPARE}
              </span>
            </div>

            {slots.length === 0 ? (
              <EmptyState
                icon="⚖️"
                title="选择 2-3 位候选人开始对比"
                description="从下拉列表中添加候选人以查看能力雷达"
              />
            ) : (
              <div className="hp-compare-grid" data-testid="hp-compare-grid">
                {slots.map((slot) => {
                  const card = cardById.get(slot.recId);
                  if (!card) {
                    // Card no longer on the board (e.g. another hunter claimed it).
                    return (
                      <div
                        key={slot.recId}
                        className="hp-compare-col"
                        data-testid="hp-compare-col"
                      >
                        <div className="hp-compare-col-header">
                          <span className="hp-compare-col-name">(已不在看板)</span>
                          <button
                            type="button"
                            className="hp-compare-col-remove"
                            onClick={() => removeSlot(slot.recId)}
                            data-testid="hp-compare-remove"
                          >
                            移除
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={slot.recId}
                      className="hp-compare-col"
                      data-testid="hp-compare-col"
                      data-rec-id={slot.recId}
                    >
                      <div className="hp-compare-col-header">
                        <span className="hp-compare-col-name" data-testid="hp-compare-name">
                          {card.candidate_name ?? '(匿名)'}
                        </span>
                        <button
                          type="button"
                          className="hp-compare-col-remove"
                          onClick={() => removeSlot(slot.recId)}
                          data-testid="hp-compare-remove"
                          aria-label="移除候选人"
                        >
                          移除
                        </button>
                      </div>
                      <div className="hp-compare-col-job">
                        <PipelineStageBadge stage={card.pipeline_stage} size="sm" />
                        <span style={{ marginLeft: 8 }}>{card.job_title}</span>
                      </div>
                      <RadarChart dimensions={buildRadar(card)} size={240} />
                      <div className="hp-compare-col-attr">
                        <span className="hp-compare-col-attr-key">工作</span>
                        <span>{card.job_title}</span>
                      </div>
                      <div className="hp-compare-col-attr">
                        <span className="hp-compare-col-attr-key">阶段</span>
                        <PipelineStageBadge stage={card.pipeline_stage} size="sm" />
                      </div>
                      <div className="hp-compare-col-attr">
                        <span className="hp-compare-col-attr-key">匹配度</span>
                        <span>
                          {card.match_score != null
                            ? `${Math.round(card.match_score * 100)}%`
                            : '-'}
                        </span>
                      </div>
                      <div className="hp-compare-col-attr">
                        <span className="hp-compare-col-attr-key">推荐 ID</span>
                        <span>{card.recommendation_id}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </HunterMobileLayout>
    </div>
  );
}
