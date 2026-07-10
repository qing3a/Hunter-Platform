import { useMemo, useState } from 'react';
import { pmProjects, type Project } from '../../api/pm-portal';
import {
  ProjectMetaForm,
  validateProjectMeta,
  type ProjectMetaFormValue,
} from './ProjectMetaForm';

// ============================================================================
// CreateProjectModal (S8 / Task 15)
// ============================================================================
//
// Modal dialog opened from the "+ 新建项目" button in ProjectsLibraryPage.
// Replaces the Task 4 placeholder with a real form. The modal owns three
// local pieces of state:
//
//   - `value`         form data (mirrors the ProjectMetaForm shape)
//   - `phase`         'idle' | 'submitting' | 'error' — drives button
//                     labels and disables the close affordances while a
//                     network request is in flight
//   - `submitError`   populated when pmProjects.create rejects; cleared
//                     on retry
//
// Submission flow:
//   1. PM clicks "创建" → set phase='submitting' → call
//      pmProjects.create({...})
//   2a. Success → onCreated(project) so the parent can refetch + navigate
//                 to the new project's detail page; then onClose().
//   2b. Failure → setSubmitError(message) + phase='idle' so the PM can
//                 fix the form and retry without losing their input.
//
// Backdrop click is a no-op while submitting (would race the request).
// Cancel is the only way out during that phase.
//
// We use the controlled-component pattern from ProjectMetaForm — the
// form is "dumb" and the modal owns the data — so the form is fully
// testable in isolation (see ProjectMetaForm.test.tsx).
//
// The backend auto-creates a default 5-stage plan when a project is
// created (see Task 2: createProjectHandler in admin-server
// src/main/modules/pm/projects.ts). We don't surface that explicitly
// here; the redirect to the new project's detail page is enough.
//
// Budget unit: the input is in **元 (yuan)**, but the backend stores
// budget_total in **分 (fen)**, the smallest CNY unit. We multiply by
// 100 here so the PM can type "5000" and see "¥5000" instead of
// "¥50.00". The form labels the input as "预算 (元)" so the unit is
// clear. Rounding is `Math.round` to keep the integer-fen invariant.

type Phase = 'idle' | 'submitting' | 'error';

const INITIAL_VALUE: ProjectMetaFormValue = {
  name: '',
  target: '',
  budget_total: null,
  start_at: null,
  end_at: null,
  current_team: [],
};

export interface CreateProjectModalProps {
  /** Called when the modal wants to close (backdrop / cancel / after success). */
  onClose: () => void;
  /**
   * Called after a successful create so the parent can refetch the
   * project list (or navigate to the new project). The newly created
   * project is passed in.
   */
  onCreated?: (project: Project) => void;
}

function buildPayload(value: ProjectMetaFormValue) {
  // Strip the local-only `id` field from team members; the backend
  // doesn't know about it. Empty / blank role rows are filtered out so
  // a PM who clicks "添加成员" then walks away without filling the
  // role doesn't end up submitting `{ role: '', count: 1 }` (which
  // the backend's Zod schema would reject).
  const team = value.current_team
    .map((m) => ({ role: m.role.trim(), count: m.count }))
    .filter((m) => m.role.length > 0);

  return {
    name: value.name.trim(),
    ...(value.target.trim().length > 0 ? { target: value.target.trim() } : {}),
    ...(value.budget_total != null
      ? { budget_total: Math.round(value.budget_total) * 100 }
      : {}),
    ...(value.start_at != null ? { start_at: value.start_at } : {}),
    ...(value.end_at != null ? { end_at: value.end_at } : {}),
    ...(team.length > 0 ? { current_team: team } : {}),
  };
}

export function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const [value, setValue] = useState<ProjectMetaFormValue>(INITIAL_VALUE);
  const [phase, setPhase] = useState<Phase>('idle');
  const [submitError, setSubmitError] = useState<string>('');
  // Used to flip the form into "show all errors" mode after a failed
  // submit attempt. Reset on every successful submit.
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validateProjectMeta(value), [value]);
  const isValid = Object.keys(errors).length === 0;
  const busy = phase === 'submitting';

  async function onSubmit() {
    if (busy) return;
    if (!isValid) {
      setShowErrors(true);
      return;
    }
    setPhase('submitting');
    setSubmitError('');
    try {
      const project = await pmProjects.create(buildPayload(value));
      onCreated?.(project);
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message || '创建失败');
      setPhase('error');
    }
  }

  // Click anywhere on the backdrop → close (unless a request is in
  // flight, where a click could race the response).
  function onBackdropClick() {
    if (busy) return;
    onClose();
  }

  return (
    <div
      className="pm-modal-backdrop"
      data-testid="pm-create-project-modal"
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        className="pm-modal pm-create-project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-create-project-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pm-create-project-modal-header">
          <h2
            id="pm-create-project-modal-title"
            className="pm-create-project-modal-title"
          >
            新建项目
          </h2>
          <button
            type="button"
            className="pm-btn-link pm-create-project-modal-close"
            data-testid="pm-create-project-modal-close"
            onClick={() => { if (!busy) onClose(); }}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="pm-create-project-modal-body">
          <ProjectMetaForm
            value={value}
            onChange={setValue}
            showErrors={showErrors}
            disabled={busy}
            testIdPrefix="pm-project-form"
          />
        </div>

        {submitError && (
          <p
            className="pm-create-project-error"
            role="alert"
            data-testid="pm-create-project-error"
          >
            创建失败:{submitError}
          </p>
        )}

        <footer className="pm-create-project-modal-footer">
          <button
            type="button"
            className="pm-btn-secondary"
            onClick={onClose}
            disabled={busy}
            data-testid="pm-create-project-cancel"
          >
            取消
          </button>
          <button
            type="button"
            className="pm-btn-primary"
            onClick={onSubmit}
            disabled={busy || (showErrors && !isValid)}
            data-testid="pm-create-project-submit"
          >
            {busy ? '创建中…' : '创建项目'}
          </button>
        </footer>
      </div>
    </div>
  );
}
