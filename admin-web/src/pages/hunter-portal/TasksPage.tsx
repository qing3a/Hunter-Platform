import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HunterMobileLayout } from '../../components/hunter-portal/HunterMobileLayout';
import { HunterSidebar } from '../../components/hunter-portal/HunterSidebar';
import { EmptyState } from '../../components/candidate-portal/EmptyState';
import {
  tasks,
  type HunterTask,
  type TaskPriority,
} from '../../api/hunter-portal';

type TabKey = 'pending' | 'completed';

const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

/**
 * Hunter Portal — Tasks page (Phase 3a / Task 16).
 *
 * CRUD interface for hunter tasks with two tabs (Pending / Completed).
 *
 *   - "+ 添加任务" reveals an inline form (title / description / priority).
 *   - Per-row actions: ✓ complete, ↺ reopen, ✎ edit, 🗑 delete.
 *
 * Mutations invalidate the `['hunter', 'tasks']` query so the list
 * refetches and the new state becomes visible. The "Completed" tab uses
 * the same query key with `status: 'completed'` so completing a task
 * also refetches it into the completed list automatically.
 *
 * The "edit" action reuses the inline form: clicking ✎ on a row loads
 * that row's values into the form and switches the submit handler to
 * call `tasks.update()` instead of `tasks.create()`.
 */
export function TasksPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pending');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');

  const { data, isLoading, error } = useQuery({
    queryKey: ['hunter', 'tasks', { status: tab }],
    queryFn: () => tasks.list({ status: tab }),
  });

  const list: HunterTask[] = data ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      tasks.create({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'tasks'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      tasks.update(id, {
        title: title.trim(),
        description: description.trim() || null,
        priority,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'tasks'] });
      resetForm();
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => tasks.complete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'tasks'] });
      queryClient.invalidateQueries({ queryKey: ['hunter', 'dashboard'] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => tasks.reopen(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'tasks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tasks.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunter', 'tasks'] });
    },
  });

  function resetForm() {
    setTitle('');
    setDescription('');
    setPriority('normal');
    setFormOpen(false);
    setEditingId(null);
  }

  function startEdit(task: HunterTask) {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(task.priority);
    setEditingId(task.id);
    setFormOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (editingId) {
      updateMutation.mutate(editingId);
    } else {
      createMutation.mutate();
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const formError = (createMutation.error || updateMutation.error) as Error | null;

  return (
    <div className="hp-page" data-testid="hp-page-tasks">
      <HunterSidebar />
      <HunterMobileLayout title="任务">
        <div className="hp-task-tabs" data-testid="hp-task-tabs">
          <button
            type="button"
            className={`hp-task-tab ${tab === 'pending' ? 'active' : ''}`}
            onClick={() => setTab('pending')}
            data-testid="hp-task-tab-pending"
            aria-pressed={tab === 'pending'}
          >
            待办
            <span className="hp-task-tab-count">
              {tab === 'pending' && list.length > 0 ? `(${list.length})` : ''}
            </span>
          </button>
          <button
            type="button"
            className={`hp-task-tab ${tab === 'completed' ? 'active' : ''}`}
            onClick={() => setTab('completed')}
            data-testid="hp-task-tab-completed"
            aria-pressed={tab === 'completed'}
          >
            已完成
            <span className="hp-task-tab-count">
              {tab === 'completed' && list.length > 0 ? `(${list.length})` : ''}
            </span>
          </button>
        </div>

        <div className="hp-task-add-toggle">
          {!formOpen ? (
            <button
              type="button"
              className="hp-btn-primary"
              onClick={() => { resetForm(); setFormOpen(true); }}
              data-testid="hp-task-add-toggle"
            >
              + 添加任务
            </button>
          ) : (
            <form
              className="hp-task-add-form"
              onSubmit={handleSubmit}
              data-testid="hp-task-add-form"
            >
              <input
                type="text"
                placeholder="任务标题 *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                data-testid="hp-task-input-title"
                aria-label="任务标题"
              />
              <textarea
                placeholder="任务描述（可选）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="hp-task-input-description"
                aria-label="任务描述"
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                data-testid="hp-task-input-priority"
                aria-label="优先级"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <div className="hp-task-add-form-actions">
                <button
                  type="submit"
                  className="hp-btn-primary"
                  disabled={isSubmitting || !title.trim()}
                  data-testid="hp-task-submit"
                >
                  {isSubmitting
                    ? '保存中...'
                    : editingId
                      ? '保存修改'
                      : '创建任务'}
                </button>
                <button
                  type="button"
                  className="hp-btn-secondary"
                  onClick={resetForm}
                  disabled={isSubmitting}
                  data-testid="hp-task-cancel"
                >
                  取消
                </button>
              </div>
              {formError && (
                <div className="hp-error" data-testid="hp-task-form-error">
                  操作失败: {formError.message}
                </div>
              )}
            </form>
          )}
        </div>

        {isLoading && (
          <div className="hp-loading" data-testid="hp-tasks-loading">加载中...</div>
        )}

        {error && !isLoading && (
          <div className="hp-error" data-testid="hp-tasks-error">
            加载失败: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && list.length === 0 && (
          <EmptyState
            icon="✅"
            title={tab === 'pending' ? '暂无待办任务' : '暂无已完成任务'}
            description={tab === 'pending' ? '点击「+ 添加任务」创建一条' : '完成任务后会显示在这里'}
          />
        )}

        {!isLoading && !error && list.length > 0 && (
          <ul className="hp-task-list" data-testid="hp-tasks-list">
            {list.map((task) => {
              const isCompleted = !!task.completed_at;
              return (
                <li
                  key={task.id}
                  className="hp-task-row"
                  data-testid="hp-tasks-row"
                  data-task-id={task.id}
                  data-completed={isCompleted ? 'true' : 'false'}
                >
                  <span
                    className="hp-task-priority"
                    data-priority={task.priority}
                    data-testid="hp-tasks-priority"
                  >
                    {task.priority}
                  </span>
                  <span className="hp-task-title" data-testid="hp-tasks-title">
                    {task.title}
                  </span>
                  {task.due_at != null && (
                    <span className="hp-task-due" data-testid="hp-tasks-due">
                      {new Date(task.due_at).toLocaleDateString()}
                    </span>
                  )}
                  <div className="hp-task-row-actions">
                    {!isCompleted ? (
                      <button
                        type="button"
                        className="hp-task-row-btn"
                        onClick={() => completeMutation.mutate(task.id)}
                        data-testid="hp-tasks-complete"
                        aria-label="标记为已完成"
                      >
                        ✓
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="hp-task-row-btn"
                        onClick={() => reopenMutation.mutate(task.id)}
                        data-testid="hp-tasks-reopen"
                        aria-label="重新打开"
                      >
                        ↺
                      </button>
                    )}
                    <button
                      type="button"
                      className="hp-task-row-btn"
                      onClick={() => startEdit(task)}
                      data-testid="hp-tasks-edit"
                      aria-label="编辑"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="hp-task-row-btn"
                      data-variant="danger"
                      onClick={() => {
                        if (confirm(`确定删除任务「${task.title}」？`)) {
                          deleteMutation.mutate(task.id);
                        }
                      }}
                      data-testid="hp-tasks-delete"
                      aria-label="删除"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </HunterMobileLayout>
    </div>
  );
}
