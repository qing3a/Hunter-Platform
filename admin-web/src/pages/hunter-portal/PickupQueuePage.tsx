import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import { pickup, type PendingPickupItem } from '../../api/hunter-portal';

/**
 * Hunter Portal — Pickup Queue page (Phase 3a / Task 13).
 *
 * Lists self-applied recommendations whose status is still `pending_pickup`
 * (no headhunter has claimed them yet). Each row exposes a 认领 button that
 * POSTs `/v1/headhunter/recommendations/:id/pickup`, which atomically flips
 * the recommendation to `pending` and stamps `pickup_headhunter_id`.
 *
 * Filtering: the backend only accepts `limit` / `offset`, so the industry +
 * keyword filters in the toolbar are applied client-side over the page we
 * already fetched. Industry is offered as a UI affordance to match the
 * sibling pages; today there is no `industry` column on the pickup row so
 * it acts as a no-op (the placeholder list below documents the future
 * server-side contract). Keyword matches against `candidate_display_name`
 * and `job_title` (case-insensitive substring).
 */
export function PickupQueuePage() {
  const [industry, setIndustry] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'pickup', 'list'],
    queryFn: () => pickup.listPending({ limit: 50 }),
  });

  const claimMutation = useMutation({
    mutationFn: (recommendationId: string) => pickup.claim(recommendationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'pickup'] });
      queryClient.invalidateQueries({ queryKey: ['hunter', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['hunter', 'kanban'] });
    },
  });

  const filtered = useMemo<PendingPickupItem[]>(() => {
    const items = data?.items ?? [];
    const needle = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (industry && item.recommendation_status !== industry) {
        // No industry column on the row yet; reserved hook for future server-side filter.
      }
      if (!needle) return true;
      const name = (item.candidate_display_name ?? '').toLowerCase();
      const job = (item.job_title ?? '').toLowerCase();
      return name.includes(needle) || job.includes(needle);
    });
  }, [data, industry, keyword]);

  return (
    <div className="hp-page" data-testid="hp-page-pickup">
      <HunterSidebar />
      <HunterMobileLayout title="待认领">
        <section className="hp-filters" data-testid="hp-pickup-filters">
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            data-testid="hp-pickup-industry"
            aria-label="行业筛选"
          >
            <option value="">所有行业</option>
            <option value="互联网">互联网</option>
            <option value="金融">金融</option>
            <option value="教育">教育</option>
          </select>
          <input
            type="search"
            placeholder="搜索姓名 / 工作"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            data-testid="hp-pickup-keyword"
            aria-label="关键词搜索"
          />
        </section>

        {isLoading && (
          <div className="hp-loading" data-testid="hp-pickup-loading">加载中...</div>
        )}

        {error && !isLoading && (
          <div className="hp-error" data-testid="hp-pickup-error">
            加载失败: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <EmptyState
            icon="📭"
            title="暂无待认领候选人"
            description="所有自荐申请均已被认领"
          />
        )}

        {!isLoading && !error && filtered.length > 0 && (
          <table className="hp-table" data-testid="hp-pickup-table">
            <thead>
              <tr>
                <th>候选人</th>
                <th>工作</th>
                <th>申请时间</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isPending = claimMutation.isPending &&
                  claimMutation.variables === item.recommendation_id;
                return (
                  <tr
                    key={item.recommendation_id}
                    data-testid="hp-pickup-row"
                    data-rec-id={item.recommendation_id}
                  >
                    <td>{item.candidate_display_name ?? '(匿名)'}</td>
                    <td>{item.job_title ?? '-'}</td>
                    <td>{new Date(item.created_at).toLocaleString()}</td>
                    <td>{item.candidate_note ?? '-'}</td>
                    <td>
                      <button
                        type="button"
                        className="hp-btn-primary"
                        disabled={claimMutation.isPending}
                        onClick={() => claimMutation.mutate(item.recommendation_id)}
                        data-testid="hp-pickup-claim"
                      >
                        {isPending ? '认领中...' : '认领'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {claimMutation.isError && (
          <div className="hp-error" data-testid="hp-pickup-claim-error">
            认领失败: {(claimMutation.error as Error).message}
          </div>
        )}
      </HunterMobileLayout>
    </div>
  );
}
