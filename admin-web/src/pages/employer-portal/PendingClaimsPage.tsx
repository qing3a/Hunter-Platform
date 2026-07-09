import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  employerPendingClaims,
  type Job,
} from '../../api/employer';
import { PendingClaimRow, type PendingClaim } from '../../components/employer-portal/PendingClaimRow';

// ============================================================================
// PendingClaimsPage (Employer Portal — Task 8)
//
// Inbox of headhunter-created jobs the logged-in employer can either claim or
// reject. Backed by:
//   - GET  /v1/employer/pending-claims
//   - POST /v1/employer/pending-claims/:id/claim
//   - POST /v1/employer/pending-claims/:id/reject
// ============================================================================

const PENDING_CLAIMS_QUERY_KEY = ['employer', 'pending-claims', 'list'] as const;

type BusyState = { id: string; action: 'claim' | 'reject' } | null;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

export function PendingClaimsPage() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<BusyState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pendingClaimsQuery = useQuery<Job[]>({
    queryKey: PENDING_CLAIMS_QUERY_KEY,
    queryFn: () => employerPendingClaims.list(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const claims = (pendingClaimsQuery.data ?? []) as PendingClaim[];

  const refreshClaims = async () => {
    await queryClient.invalidateQueries({ queryKey: PENDING_CLAIMS_QUERY_KEY });
  };

  const handleClaim = async (claim: PendingClaim) => {
    setActionError(null);
    setBusy({ id: claim.id, action: 'claim' });
    try {
      await employerPendingClaims.claim(claim.id);
      await refreshClaims();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handleReject = async (claim: PendingClaim) => {
    setActionError(null);
    setBusy({ id: claim.id, action: 'reject' });
    try {
      await employerPendingClaims.reject(claim.id);
      await refreshClaims();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (pendingClaimsQuery.isLoading) {
    return (
      <div className="employer-pending-claims" data-testid="employer-pending-claims-loading">
        加载中…
      </div>
    );
  }

  if (pendingClaimsQuery.isError) {
    return (
      <div className="employer-pending-claims" data-testid="employer-pending-claims-root">
        <header className="employer-pending-claims-header">
          <h1 className="employer-pending-claims-title" data-testid="employer-pending-claims-title">
            待领取工作
          </h1>
        </header>
        <div className="employer-pending-claims-error" data-testid="employer-pending-claims-error">
          加载失败:{errorMessage(pendingClaimsQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="employer-pending-claims" data-testid="employer-pending-claims-root">
      <header className="employer-pending-claims-header">
        <h1 className="employer-pending-claims-title" data-testid="employer-pending-claims-title">
          待领取工作
        </h1>
        <span className="employer-pending-claims-count" data-testid="employer-pending-claims-count">
          {claims.length} 个待领取
        </span>
      </header>

      {actionError && (
        <div
          className="employer-pending-claims-error"
          data-testid="employer-pending-claims-action-error"
        >
          操作失败:{actionError}
        </div>
      )}

      {claims.length === 0 ? (
        <div className="employer-pending-claims-empty" data-testid="employer-pending-claims-empty">
          暂无待领取工作。猎头创建并指派给您的岗位会出现在这里。
        </div>
      ) : (
        <section className="employer-pending-claims-list" data-testid="employer-pending-claims-list">
          {claims.map((claim) => (
            <PendingClaimRow
              key={claim.id}
              claim={claim}
              busyAction={busy?.id === claim.id ? busy.action : null}
              onClaim={(nextClaim) => { void handleClaim(nextClaim); }}
              onReject={(nextClaim) => { void handleReject(nextClaim); }}
            />
          ))}
        </section>
      )}
    </div>
  );
}
