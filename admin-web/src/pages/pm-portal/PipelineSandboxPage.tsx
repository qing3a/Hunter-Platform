import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  pmPositions,
  pmSandbox,
  SANDBOX_STAGE_LABELS,
  SANDBOX_STAGE_ORDER,
  type SandboxStage,
} from '../../api/pm-portal';
import {
  SandboxFunnelCard,
  SandboxCandidateRow,
} from '../../components/pm-portal/SandboxFunnelCard';
import { PositionPicker } from '../../components/pm-portal/PositionPicker';

// ============================================================================
// PipelineSandboxPage (Task 9 / S3)
// ============================================================================
//
// The PM Sandbox is a 5-stage funnel that visualises the candidate
// pipeline for a single project_position. Each stage card shows:
//   - count                       total candidates in this stage
//   - risk indicator              red dot when any candidate is stuck
//   - expandable candidate list   per-candidate row with masked name,
//                                  relative stage-entry time, and risk chips
//
// Layout
// ------
//   1. Header    — position title + "返回项目详情" link
//   2. Meta strip — headcount planned/filled + total candidates in funnel
//   3. Funnel    — 6 SandboxFunnelCards in canonical pipeline order
//   4. Expand    — when a stage is clicked, its candidate list renders
//                  below the funnel in a scrollable panel
//
// Network
// -------
//   - pmPositions.get(id)        header data (title, headcount)
//   - pmSandbox.get(id)          funnel aggregation
//
// Routing
// -------
// /admin/pm/positions/:id/sandbox. Registered by Task 17 (admin-web App.tsx).
// For now the test file mounts the page directly via MemoryRouter.

export function PipelineSandboxPage() {
  const { id: positionId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // At most one stage is expanded at a time. Tapping a different stage
  // switches the panel; tapping the same stage collapses it. null =
  // nothing expanded (initial state).
  const [expandedStage, setExpandedStage] = useState<SandboxStage | null>(null);

  // ---- Network: position header ----
  const positionQuery = useQuery({
    queryKey: ['pm', 'positions', 'get', positionId],
    queryFn: () => pmPositions.get(positionId!),
    enabled: Boolean(positionId),
  });

  // ---- Network: project positions (Task 7 inline picker) ----
  // The S3 sandbox hosts a <PositionPicker> at the top of the page so
  // the PM can flip to another position of the same project without
  // leaving the funnel. We fetch the project's full position list and
  // hydrate the picker from it. Always-on (no gating) so the picker
  // is responsive even before the position header resolves — the
  // fallback seed is the current position.
  const projectId = positionQuery.data?.position.project_id;
  const positionsListQuery = useQuery({
    queryKey: ['pm', 'positions', 'list', projectId, 'picker'],
    queryFn: () => pmPositions.list(projectId!, { limit: 100 }),
    enabled: Boolean(projectId),
  });

  // ---- Network: sandbox aggregation ----
  const sandboxQuery = useQuery({
    queryKey: ['pm', 'sandbox', 'get', positionId],
    queryFn: () => pmSandbox.get(positionId!),
    enabled: Boolean(positionId),
  });

  // ---- Derived state ----
  // Build the stage lookup in canonical pipeline order so we can render
  // cards left-to-right regardless of the response order.
  const stageByStage = useMemo(() => {
    const map = new Map<SandboxStage, NonNullable<typeof sandboxQuery.data>['stages'][number]>();
    if (sandboxQuery.data) {
      for (const s of sandboxQuery.data.stages) map.set(s.stage, s);
    }
    return map;
  }, [sandboxQuery.data]);

  const expandedBucket = expandedStage ? stageByStage.get(expandedStage) : undefined;

  // ---- Handlers ----
  const handleToggle = (stage: SandboxStage) => {
    setExpandedStage((prev) => (prev === stage ? null : stage));
  };

  const handleBack = () => {
    const projectId = positionQuery.data?.position.project_id;
    if (projectId) {
      navigate(`/admin/pm/projects/${projectId}`);
    } else {
      navigate('/admin/pm/projects');
    }
  };

  // ---- Render ----

  if (positionQuery.isError) {
    return (
      <div className="pm-sandbox" data-testid="pm-sandbox-position-error">
        <div className="pm-sandbox-error">
          加载岗位信息失败:{String((positionQuery.error as Error)?.message ?? '未知错误')}
        </div>
        <button type="button" className="pm-sandbox-back" onClick={() => navigate('/admin/pm/projects')}>
          返回项目列表
        </button>
      </div>
    );
  }

  if (sandboxQuery.isError) {
    return (
      <div className="pm-sandbox" data-testid="pm-sandbox-error">
        <div className="pm-sandbox-error">
          加载漏斗失败:{String((sandboxQuery.error as Error)?.message ?? '未知错误')}
        </div>
        <button type="button" className="pm-sandbox-back" onClick={handleBack}>
          返回项目详情
        </button>
      </div>
    );
  }

  const position = positionQuery.data?.position;

  return (
    <div className="pm-sandbox" data-testid="pm-sandbox-root">
      <header className="pm-sandbox-header">
        <div className="pm-sandbox-header-left">
          <button
            type="button"
            className="pm-sandbox-back"
            onClick={handleBack}
            data-testid="pm-sandbox-back"
          >
            返回项目详情
          </button>
          <h1 className="pm-sandbox-title" data-testid="pm-sandbox-title">
            {position ? `${position.title} · 招聘漏斗` : '招聘漏斗'}
          </h1>
          {/*
            Inline position picker (Task 7). The picker is rendered as
            soon as the position header resolves; before that the route
            positionId isn't yet known to belong to a real project so
            we skip rendering to avoid an orphan <select>.
          */}
          {projectId && positionId && (
            <PositionPicker
              positions={[
                ...((positionsListQuery.data?.positions ?? []).map((p) => ({
                  id: p.id,
                  title: p.title,
                  title_level: p.title_level ?? undefined,
                }))),
                // Fallback: when the list hasn't resolved, or doesn't
                // include the current position, seed the picker with
                // the route position so the active selection renders.
                ...(positionsListQuery.data?.positions?.some(
                  (p) => p.id === positionId,
                )
                  ? []
                  : [
                      {
                        id: positionId,
                        title: position?.title ?? '当前岗位',
                        title_level: position?.title_level ?? undefined,
                      },
                    ]),
              ]}
              value={positionId}
              onChange={(newPositionId) => {
                if (newPositionId === positionId) return;
                navigate(
                  `/admin/pm/projects/${projectId}/positions/${newPositionId}/sandbox`,
                );
              }}
            />
          )}
        </div>
        {position && (
          <div className="pm-sandbox-meta" data-testid="pm-sandbox-meta">
            <div className="pm-sandbox-meta-row">
              <span className="pm-sandbox-meta-label">计划</span>
              <span className="pm-sandbox-meta-value">
                {position.headcount_filled}/{position.headcount_planned}
              </span>
            </div>
            <div className="pm-sandbox-meta-row">
              <span className="pm-sandbox-meta-label">漏斗总人数</span>
              <span className="pm-sandbox-meta-value" data-testid="pm-sandbox-total">
                {sandboxQuery.data?.total ?? '—'}
              </span>
            </div>
          </div>
        )}
      </header>

      {sandboxQuery.isLoading || positionQuery.isLoading ? (
        <div className="pm-sandbox-loading" data-testid="pm-sandbox-loading">
          加载中…
        </div>
      ) : (
        <>
          <section
            className="pm-sandbox-funnel"
            data-testid="pm-sandbox-funnel"
            aria-label="5 阶段招聘漏斗"
          >
            {SANDBOX_STAGE_ORDER.map((stage) => {
              const bucket = stageByStage.get(stage);
              if (!bucket) return null;
              return (
                <SandboxFunnelCard
                  key={stage}
                  bucket={bucket}
                  isExpanded={expandedStage === stage}
                  onToggle={handleToggle}
                />
              );
            })}
          </section>

          {expandedStage && (
            <section
              className="pm-sandbox-expanded"
              data-testid="pm-sandbox-expanded"
              data-stage={expandedStage}
            >
              <header className="pm-sandbox-expanded-header">
                <h2 className="pm-sandbox-expanded-title">
                  {SANDBOX_STAGE_LABELS[expandedStage]} 阶段候选人
                </h2>
                <span className="pm-sandbox-expanded-count">
                  共 {expandedBucket?.count ?? 0} 人
                  {expandedBucket && expandedBucket.candidates.length < expandedBucket.count
                    ? ` (显示前 ${expandedBucket.candidates.length})`
                    : ''}
                </span>
              </header>
              {expandedBucket && expandedBucket.candidates.length > 0 ? (
                <div className="pm-sandbox-candidate-list">
                  {expandedBucket.candidates.map((c) => (
                    <SandboxCandidateRow
                      key={c.recommendation_id}
                      candidate={c}
                      stage={expandedStage}
                    />
                  ))}
                </div>
              ) : (
                <div className="pm-sandbox-empty" data-testid="pm-sandbox-expanded-empty">
                  此阶段暂无候选人
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}