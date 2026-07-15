import { defineCapabilitySet } from './types.js';

/**
 * HR Workspace (Phase 3a) — 猎头工作台视图 (dashboard / tasks / kanban / stats).
 * 路由: /v1/headhunter-workspace/*
 * Auth: bearer session / apikey (handler-level assertHeadhunter); roleGate 在 hr 这边。
 *
 * Capability 集合的 role 用 'hr' — 即使路由前缀既包括 headhunter 又包括
 * headhunter-workspace，handler 内部 assertHeadhunter() 守的是 hr role。
 */
export const headhunterWorkspaceCapabilities = defineCapabilitySet({
  role: 'hr',
  capabilities: [
    {
      name: 'headhunter_workspace.dashboard',
      description: '猎头工作台首页聚合数据 (按 candidate / rec / placement 计数)。',
      method: 'GET', path: '/v1/headhunter-workspace/dashboard',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_dashboard.aggregate'],
    },
    {
      name: 'headhunter_workspace.tasks.list',
      description: '猎头列自己的任务 (按 status 过滤: pending|completed|all)。',
      method: 'GET', path: '/v1/headhunter-workspace/tasks',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_tasks.listByHunter'],
    },
    {
      name: 'headhunter_workspace.tasks.create',
      description: '猎头创建任务 (字段: title, description?, due_at?, priority?, related_recommendation_id?, related_candidate_user_id?)。',
      method: 'POST', path: '/v1/headhunter-workspace/tasks',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_tasks.insert'],
    },
    {
      name: 'headhunter_workspace.tasks.update',
      description: '猎头更新任务 (title / description / due_at / priority)。',
      method: 'PUT', path: '/v1/headhunter-workspace/tasks/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_tasks.update'],
    },
    {
      name: 'headhunter_workspace.tasks.delete',
      description: '猎头删除任务。',
      method: 'DELETE', path: '/v1/headhunter-workspace/tasks/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_tasks.delete'],
    },
    {
      name: 'headhunter_workspace.tasks.complete',
      description: '猎头标记任务完成 (state: pending → completed)。',
      method: 'POST', path: '/v1/headhunter-workspace/tasks/:id/complete',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_tasks.updateStatus(completed)'],
    },
    {
      name: 'headhunter_workspace.tasks.reopen',
      description: '重新打开已完成任务 (state: completed → pending)。',
      method: 'POST', path: '/v1/headhunter-workspace/tasks/:id/reopen',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_tasks.updateStatus(pending)'],
    },
    {
      name: 'headhunter_workspace.kanban.read',
      description: '读取 kanban 板 (columns + cards, 按 hunter_id scope)。',
      method: 'GET', path: '/v1/headhunter-workspace/kanban',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.kanban_columns.listByHunter', 'db.kanban_cards.listByHunter'],
    },
    {
      name: 'headhunter_workspace.kanban.move',
      description: '移动 card (列间; body: recommendation_id, to_column_id, to_position?)。',
      method: 'POST', path: '/v1/headhunter-workspace/kanban/move',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.kanban_cards.updatePosition'],
    },
    {
      name: 'headhunter_workspace.kanban.add',
      description: '添加 card (body: recommendation_id, to_column_id)。',
      method: 'POST', path: '/v1/headhunter-workspace/kanban/add',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.kanban_cards.insert'],
    },
    {
      name: 'headhunter_workspace.kanban.remove',
      description: '移除 card (body: recommendation_id)。',
      method: 'POST', path: '/v1/headhunter-workspace/kanban/remove',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.kanban_cards.delete'],
    },
    {
      name: 'headhunter_workspace.stats',
      description: '业绩 + 漏斗统计 (overview + funnel by date range ?from=&to=)。',
      method: 'GET', path: '/v1/headhunter-workspace/stats',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.hunter_stats.aggregate'],
    },
  ],
});
