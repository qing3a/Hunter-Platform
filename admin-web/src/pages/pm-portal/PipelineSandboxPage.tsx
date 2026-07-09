import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  pmPositions,
  pmSandbox,
  SANDBOX_STAGE_ORDER,
  type SandboxStage,
} from '../../api/pm-portal';
import { SandboxFunnelCard } from '../../components/pm-portal/SandboxFunnelCard';
import { OnTrackAlert } from '../../components/pm-portal/OnTrackAlert';
import { PositionPicker } from '../../components/pm-portal/PositionPicker';
import { useToast } from '../../lib/toast';

// ============================================================================
// PipelineSandboxPage (Task 8 / S3)
// ============================================================================
//
// The PM Sandbox is a 6-stage funnel that visualises the candidate
// pipeline for a single project_position. Each stage card shows:
//   - count                       total candidates in this stage
//   - risk indicator              red dot when any candidate is stuck
//   - inline candidate list       always visible (Task 8 — no click-to-expand)
//
// Footer
//   - <OnTrackAlert>              green or amber banner comparing
//                                  {offer + onboarded} vs headcount_planned
// Top-right
//   - 📋 导出报告 button          toast on click (v1 placeholder)
//
// Layout
// ------
//   1. Header    — back link, position title, inline PositionPicker,
//                  导出报告 button, headcount meta strip
//   2. Funnel    — 6 SandboxFunnelCards in canonical pipeline order
//   3. Alert     — OnTrackAlert at the very bottom of the page
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
  const toast = useToast();

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

  // ---- OnTrackAlert metrics (Task 8) ----
  // Total of candidates currently holding an `offer` or having reached
  // `onboarded`. Compare against the position's planned headcount.
  const offerOnboardedCount = useMemo(() => {
    if (!sandboxQuery.data) return 0;
    const offerBucket = stageByStage.get('offer');
    const onboardedBucket = stageByStage.get('onboarded');
    return (offerBucket?.count ?? 0) + (onboardedBucket?.count ?? 0);
  }, [sandboxQuery.data, stageByStage]);

  const target = positionQuery.data?.position.headcount_planned ?? 0;

  // ---- Handlers ----
  const handleBack = () => {
    const projId = positionQuery.data?.position.project_id;
    if (projId) {
      navigate(`/admin/pm/projects/${projId}`);
    } else {
      navigate('/admin/pm/projects');
    }
  };

  const handleExport = () => {
    // v1 placeholder: real export (PDF / CSV) is out-of-scope. We surface
    // a toast so the PM knows the button is wired up.
    toast.push({
      type: 'info',
      message: '导出报告功能即将上线',
    });
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
          {/*
            Top-right action bar (Task 8). Sits inside the same flex row
            as the title so we don't need a second header line.
          */}
          <div className="pm-sandbox-actions">
            <button
              type="button"
              className="pm-sandbox-export-btn"
              onClick={handleExport}
              data-testid="pm-sandbox-export-btn"
            >
              📋 导出报告
            </button>
          </div>
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
            aria-label="6 阶段招聘漏斗"
          >
            {SANDBOX_STAGE_ORDER.map((stage) => {
              const bucket = stageByStage.get(stage);
              if (!bucket) return null;
              return (
                <SandboxFunnelCard
                  key={stage}
                  bucket={bucket}
                />
              );
            })}
          </section>

          {/*
            Task 8 — bottom-of-page on-track alert. Renders once the
            position header has loaded (so we have a target). It is
            independent of the sandbox query so it surfaces even when
            the funnel is still loading.
          */}
          {position && (
            <OnTrackAlert
              offerOnboarded={offerOnboardedCount}
              target={target}
            />
          )}
        </>
      )}
    </div>
  );
}
