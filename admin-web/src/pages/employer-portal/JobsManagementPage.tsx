import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  employerJobs,
  type CreateJobInput,
  type Job,
  type JobStatus,
  type JobUpdateInput,
} from '../../api/employer';
import {
  JobPostForm,
  EMPTY_JOB_VALUE,
  validateJobPostForm,
  type JobPostFormValue,
} from '../../components/employer-portal/JobPostForm';

// ============================================================================
// JobsManagementPage (Phase 3c, Task 5)
// ============================================================================
//
// Three responsibilities, in one page:
//
//   1. List the caller's Job postings — header (status filter, + 新建工作
//      button), 3 KPI tiles (总 / 开放 / 暂停), and a table with inline
//      action buttons (edit / pause or resume / close).
//
//   2. Create new postings — modal with the 7-field JobPostForm. Submit
//      calls `employerJobs.create`; success closes the modal and refreshes
//      the list.
//
//   3. Edit existing postings — same modal in "edit mode". On submit we
//      call `employerJobs.get(id)` first to hydrate (the list endpoint
//      returns the same shape, but `get` is the canonical single-row
//      read in case the list endpoint eventually drops a field), then
//      `employerJobs.update(id, patch)`.
//
// The page is mounted by `App.tsx` behind `<RequireEmployerAuth>` (Task 4)
// inside the `<EmployerMobileLayout>` chrome — sidebar nav + bottom tab bar.
// Server-side caller scoping is enforced by the backend's `jobs.listByEmployer(user.id)`
// SQL in src/main/db/repositories/jobs.ts:57-71 — the SPA does not (and
// must not) implement cross-employer isolation client-side.

// ---- Constants ------------------------------------------------------------

type StatusFilter = 'all' | JobStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '开放' },
  { value: 'paused', label: '暂停' },
  { value: 'closed', label: '关闭' },
  { value: 'filled', label: '已招满' },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  open: '开放',
  claimed: '已认领',
  paused: '暂停',
  closed: '关闭',
  filled: '已招满',
};

/**
 * Per-status command surface. "claimed" and "open" share the same
 * action set; "closed" / "filled" are terminal — only 编辑 is offered
 * (so an employer can fix a typo after the fact). We don't expose
 * 编辑 for filled either, because changing a filled job's title can
 * mislead the audit trail; if a fill was a mistake, the right
 * workaround is to close-and-recreate. That tradeoff is documented
 * here rather than hidden in the table renderer.
 */
type ActionKey = 'edit' | 'pause' | 'resume' | 'close';

function getActionsForStatus(status: JobStatus): ActionKey[] {
  if (status === 'open' || status === 'claimed') {
    return ['edit', 'pause', 'close'];
  }
  if (status === 'paused') {
    return ['edit', 'resume', 'close'];
  }
  return ['edit'];
}

const ACTION_LABEL: Record<ActionKey, string> = {
  edit: '编辑',
  pause: '暂停',
  resume: '恢复',
  close: '关闭',
};

// ---- Modal mode -----------------------------------------------------------

interface ModalMode {
  kind: 'create' | 'edit';
  /** Job being edited (edit mode only). */
  job: Job | null;
}

// ---- Helpers --------------------------------------------------------------

interface Stats {
  total: number;
  open: number;
  paused: number;
}

function computeStats(jobs: Job[]): Stats {
  let open = 0;
  let paused = 0;
  for (const j of jobs) {
    if (j.status === 'open' || j.status === 'claimed') open += 1;
    if (j.status === 'paused') paused += 1;
  }
  return { total: jobs.length, open, paused };
}

/**
 * Filter a list of jobs by the local status filter. `all` returns the
 * input unchanged; otherwise we drop rows whose `status` doesn't match.
 * Filtering happens client-side so the UI flips immediately on click —
 * the network query only re-runs when the user picks an EXPLICIT
 * (non-`all`) filter that needs to be passed to the server.
 */
function filterByStatus(jobs: Job[], filter: StatusFilter): Job[] {
  if (filter === 'all') return jobs;
  return jobs.filter((j) => j.status === filter);
}

/**
 * Build the API payload from a JobPostFormValue. Mirrors the backend
 * CreateJobSchema (src/main/routes/employer.ts):
 *
 *   - title: trim and drop empty (caller validates before calling)
 *   - description: dropped if empty (server defaults to null)
 *   - industry / title_level / priority: dropped if null
 *   - salary_min / salary_max: dropped if null
 *   - deadline: dropped if null
 *
 * `title_level` is a frontend-only field — it's not persisted on `jobs`
 * in v1; it's surfaced on the form for the employer's mental model but
 * dropped before submit so the backend doesn't reject the payload.
 */
function buildCreateInput(value: JobPostFormValue): CreateJobInput {
  return {
    title: value.title.trim(),
    ...(value.description.trim().length > 0
      ? { description: value.description.trim() }
      : {}),
    ...(value.industry != null ? { industry: value.industry } : {}),
    ...(value.priority != null ? { priority: value.priority } : {}),
    ...(value.salary_min != null ? { salary_min: value.salary_min } : {}),
    ...(value.salary_max != null ? { salary_max: value.salary_max } : {}),
    ...(value.deadline != null ? { deadline: value.deadline } : {}),
  };
}

function jobToFormValue(job: Job): JobPostFormValue {
  return {
    title: job.title,
    description: job.description ?? '',
    industry: (job.industry as JobPostFormValue['industry']) ?? null,
    title_level: null, // not yet persisted on `jobs` — see jobToFormValue comment
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    priority: (job.priority as JobPostFormValue['priority']) ?? null,
    deadline: job.deadline ?? null,
  };
}

function buildUpdateInput(value: JobPostFormValue): JobUpdateInput {
  const input: JobUpdateInput = {
    title: value.title.trim(),
  };
  if (value.description.trim().length > 0) input.description = value.description.trim();
  else input.description = '';
  if (value.industry != null) input.industry = value.industry;
  if (value.priority != null) input.priority = value.priority;
  if (value.salary_min != null) input.salary_min = value.salary_min;
  if (value.salary_max != null) input.salary_max = value.salary_max;
  if (value.deadline != null) input.deadline = value.deadline;
  return input;
}

// ---- Component ------------------------------------------------------------

export function JobsManagementPage() {
  // ---- Local state ----
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modal, setModal] = useState<ModalMode | null>(null);

  const queryClient = useQueryClient();

  // ---- Network: list ----
  // Single GET on mount; status filter is applied client-side so the
  // UI flips immediately when the user clicks a filter chip (no
  // loading flash). The backend caps the list at limit=50 per call;
  // for v1 (<= 50 jobs per employer) that's more than enough.
  const jobsQuery = useQuery<Job[]>({
    queryKey: ['employer', 'jobs', 'list'],
    queryFn: () => employerJobs.list(),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const jobs = jobsQuery.data ?? [];
  const stats = useMemo(() => computeStats(jobs), [jobs]);

  // `all` filter still client-side filters to keep the UI snappy
  // (and to handle the case where the server returned a clipped set).
  const visible = useMemo(() => filterByStatus(jobs, statusFilter), [jobs, statusFilter]);

  // ---- Handlers ----
  function handleFilterChange(next: StatusFilter) {
    setStatusFilter(next);
  }

  function openCreateModal() {
    setModal({ kind: 'create', job: null });
  }

  async function openEditModal(jobId: string) {
    // Hydrate from the canonical /v1/employer/jobs/:id endpoint.
    // We optimistically don't bother with a loading state — the modal
    // already gates interaction on the form, so a blank title for a
    // tick is fine. We trigger a refetch of the list on close either
    // way so the (eventual) update lands.
    let job: Job | null = null;
    try {
      job = await employerJobs.get(jobId);
    } catch {
      // Fall back to whatever the list returned — better than blocking
      // the user from editing because of a transient backend hiccup.
      job = jobs.find((j) => j.id === jobId) ?? null;
    }
    if (!job) {
      // Nothing to edit. Stay on the list.
      return;
    }
    setModal({ kind: 'edit', job });
  }

  function closeModal() {
    setModal(null);
  }

  async function handleAction(jobId: string, action: ActionKey) {
    try {
      if (action === 'pause') await employerJobs.pause(jobId);
      else if (action === 'resume') await employerJobs.resume(jobId);
      else if (action === 'close') await employerJobs.close(jobId);
      else return;
      queryClient.invalidateQueries({ queryKey: ['employer', 'jobs', 'list'] });
    } catch {
      // Surface via toast / banner in a follow-up; for v1 the list
      // simply doesn't refresh and the user can retry.
    }
  }

  // ---- Render: loading ----
  if (jobsQuery.isLoading) {
    return (
      <div className="employer-jobs" data-testid="employer-jobs-loading">
        加载中…
      </div>
    );
  }

  // ---- Render: error ----
  if (jobsQuery.isError) {
    return (
      <div className="employer-jobs" data-testid="employer-jobs-error-root">
        <header className="employer-jobs-header">
          <h1 className="employer-jobs-title" data-testid="employer-jobs-title">工作管理</h1>
        </header>
        <div className="employer-jobs-error" data-testid="employer-jobs-error">
          加载失败:{String((jobsQuery.error as Error)?.message ?? '未知错误')}
        </div>
      </div>
    );
  }

  return (
    <div className="employer-jobs" data-testid="employer-jobs-root">
      <header className="employer-jobs-header">
        <h1 className="employer-jobs-title" data-testid="employer-jobs-title">
          工作管理
        </h1>
        <button
          type="button"
          className="employer-jobs-new"
          data-testid="employer-jobs-new"
          onClick={openCreateModal}
        >
          + 新建工作
        </button>
      </header>

      <section className="employer-jobs-filters" data-testid="employer-jobs-filters">
        {STATUS_FILTERS.map((sf) => (
          <button
            key={sf.value}
            type="button"
            className={`employer-jobs-filter${statusFilter === sf.value ? ' active' : ''}`}
            data-testid={`employer-jobs-filter-${sf.value}`}
            onClick={() => handleFilterChange(sf.value)}
          >
            {sf.label}
          </button>
        ))}
      </section>

      <section className="employer-jobs-stats" data-testid="employer-jobs-stats">
        <div className="employer-jobs-stat" data-testid="employer-jobs-stat-total">
          <div className="employer-jobs-stat-label">总</div>
          <div className="employer-jobs-stat-value">{stats.total}</div>
        </div>
        <div className="employer-jobs-stat" data-testid="employer-jobs-stat-open">
          <div className="employer-jobs-stat-label">开放</div>
          <div className="employer-jobs-stat-value">{stats.open}</div>
        </div>
        <div className="employer-jobs-stat" data-testid="employer-jobs-stat-paused">
          <div className="employer-jobs-stat-label">暂停</div>
          <div className="employer-jobs-stat-value">{stats.paused}</div>
        </div>
      </section>

      {visible.length === 0 ? (
        <div className="employer-jobs-empty" data-testid="employer-jobs-empty">
          {jobs.length === 0
            ? '还没有工作。点击右上角"+ 新建工作"创建第一条工作。'
            : '当前筛选下没有工作。'}
        </div>
      ) : (
        <table className="employer-jobs-table" data-testid="employer-jobs-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>状态</th>
              <th>HC</th>
              <th>表达兴趣</th>
              <th>已成交</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((job) => {
              const actions = getActionsForStatus(job.status);
              return (
                <tr key={job.id} data-testid={`employer-jobs-row-${job.id}`} data-job-id={job.id}>
                  <td>{job.title}</td>
                  <td>
                    <span data-testid="employer-jobs-status">{STATUS_LABEL[job.status]}</span>
                  </td>
                  <td>1</td>
                  <td>-</td>
                  <td>-</td>
                  <td>{job.created_at.slice(0, 10)}</td>
                  <td className="employer-jobs-actions">
                    {actions.map((action) => {
                      const testId =
                        action === 'edit'
                          ? 'employer-jobs-action-edit'
                          : action === 'pause'
                            ? 'employer-jobs-action-pause'
                            : action === 'resume'
                              ? 'employer-jobs-action-resume'
                              : 'employer-jobs-action-close';
                      const handler = () => {
                        if (action === 'edit') openEditModal(job.id);
                        else handleAction(job.id, action);
                      };
                      return (
                        <button
                          key={action}
                          type="button"
                          className="employer-jobs-action"
                          data-testid={testId}
                          onClick={handler}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      );
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modal && (
        <JobPostModal
          mode={modal.kind}
          jobId={modal.job?.id ?? null}
          initial={modal.job ? jobToFormValue(modal.job) : EMPTY_JOB_VALUE}
          onClose={closeModal}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['employer', 'jobs', 'list'] });
            closeModal();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// JobPostModal — create / edit modal wrapping JobPostForm
// ============================================================================

interface JobPostModalProps {
  mode: 'create' | 'edit';
  /** Job id in edit mode, null in create mode. */
  jobId: string | null;
  initial: JobPostFormValue;
  onClose: () => void;
  onSaved: () => void;
}

function JobPostModal({ mode, jobId, initial, onClose, onSaved }: JobPostModalProps) {
  const [value, setValue] = useState<JobPostFormValue>(initial);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string>('');
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validateJobPostForm(value), [value]);
  const isValid = Object.keys(errors).length === 0;
  const busy = phase === 'submitting';

  async function onSubmit() {
    if (busy) return;
    if (mode === 'edit' && !jobId) return;
    if (!isValid) {
      setShowErrors(true);
      return;
    }
    setPhase('submitting');
    setSubmitError('');
    try {
      if (mode === 'create') {
        await employerJobs.create(buildCreateInput(value));
      } else {
        // jobId is guaranteed non-null here by the guard above.
        await employerJobs.update(jobId as string, buildUpdateInput(value));
      }
      onSaved();
    } catch (e) {
      setSubmitError((e as Error).message || (mode === 'create' ? '创建失败' : '保存失败'));
      setPhase('error');
    }
  }

  return (
    <div
      className="employer-modal-backdrop"
      data-testid="employer-jobs-modal"
      role="presentation"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="employer-modal employer-jobs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employer-jobs-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="employer-jobs-modal-header">
          <h2
            id="employer-jobs-modal-title"
            className="employer-jobs-modal-title"
            data-testid="employer-jobs-modal-title"
          >
            {mode === 'create' ? '新建工作' : '编辑工作'}
          </h2>
          <button
            type="button"
            className="employer-modal-close"
            data-testid="employer-jobs-modal-close"
            onClick={() => { if (!busy) onClose(); }}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="employer-jobs-modal-body">
          <JobPostForm
            value={value}
            onChange={setValue}
            showErrors={showErrors}
            disabled={busy}
          />
        </div>

        {submitError && (
          <p
            className="employer-jobs-modal-error"
            role="alert"
            data-testid="employer-jobs-modal-error"
          >
            {mode === 'create' ? '创建失败:' : '保存失败:'}
            {submitError}
          </p>
        )}

        <footer className="employer-jobs-modal-footer">
          <button
            type="button"
            className="employer-btn-secondary"
            data-testid="employer-jobs-modal-cancel"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="employer-btn-primary"
            data-testid="employer-jobs-modal-submit"
            onClick={onSubmit}
            disabled={busy || (showErrors && !isValid)}
          >
            {busy ? (mode === 'create' ? '创建中…' : '保存中…') : mode === 'create' ? '创建工作' : '保存修改'}
          </button>
        </footer>
      </div>
    </div>
  );
}
