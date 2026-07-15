import { defineCapabilitySet } from './types.js';

/**
 * PM Workbench (Phase 3b / Task 1b) — PM (Project Manager) capabilities.
 *
 * Routes: /v1/pm/*
 *
 * Surface area covers the six tables introduced by v028 (projects,
 * project_positions, staffing_plans, position_decompositions, matches,
 * pm_notes) plus the cross-cutting "star a candidate" / "write a private
 * note" workflows that span multiple projects.
 *
 * Naming convention: `pm.<action>_<resource>`, all lowercase, underscore
 * between verb and resource. Mirrors the headhunter convention
 * (headhunter.upload_candidate, headhunter.recommend_candidate, ...).
 *
 * Task 1b declares these capabilities for documentation, capability:check,
 * and `/v1/capabilities` introspection. The actual router + handlers land
 * in later tasks (Task 3+). Response schemas are intentionally left
 * `undefined` here — concrete response shapes are added when the matching
 * router handler is built, mirroring how candidate-portal.ts declares its
 * caps before its router was complete.
 */
export const pmCapabilities = defineCapabilitySet({
  role: 'pm',
  capabilities: [
    // ----- Projects -----
    {
      name: 'pm.create_project',
      description: 'PM 创建新项目 (目标 / 预算 / 起止日期 / 当前团队).',
      method: 'POST', path: '/v1/pm/projects',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.projects.insert'],
    },
    {
      name: 'pm.list_projects',
      description: 'PM 列出自己管理的所有项目 (按 status 过滤).',
      method: 'GET', path: '/v1/pm/projects',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.projects.listByPm'],
    },
    {
      name: 'pm.read_project',
      description: 'PM 查看单个项目详情.',
      method: 'GET', path: '/v1/pm/projects/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.projects.findById'],
    },
    {
      name: 'pm.update_project',
      description: 'PM 更新项目字段 (目标 / 预算 / 状态).',
      method: 'PATCH', path: '/v1/pm/projects/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.projects.update'],
      // R1.C4: ow-recruit's "sync-project-to-erp" skill — patching
      // project fields is how the PM surfaces project state to the ERP.
      aliases: ['ow_recruit.sync_project_to_erp'],
    },
    {
      name: 'pm.delete_project',
      description: 'PM 删除项目 (级联删除 positions / plans / decompositions / matches).',
      method: 'DELETE', path: '/v1/pm/projects/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.projects.delete(cascade)'],
    },

    // ----- Project Positions -----
    {
      name: 'pm.create_position',
      description: 'PM 在项目下创建岗位 (headcount / salary / required_skills).',
      method: 'POST', path: '/v1/pm/projects/:projectId/positions',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.insert'],
    },
    {
      name: 'pm.read_position',
      description: 'PM 查看单个岗位详情.',
      method: 'GET', path: '/v1/pm/positions/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.findById'],
    },
    {
      name: 'pm.list_positions',
      description: 'PM 列出项目下的所有岗位.',
      method: 'GET', path: '/v1/pm/projects/:projectId/positions',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.listByProject'],
    },
    {
      name: 'pm.update_position',
      description: 'PM 更新岗位字段 (status / headcount_filled / 描述).',
      method: 'PATCH', path: '/v1/pm/positions/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.update'],
    },
    {
      name: 'pm.delete_position',
      description: 'PM 删除岗位.',
      method: 'DELETE', path: '/v1/pm/positions/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.delete'],
    },
    {
      name: 'pm.position_stats',
      description: 'PM 查项目下岗位状态统计 (open/paused/filled 各多少).',
      method: 'GET', path: '/v1/pm/projects/:projectId/positions/stats',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.aggregateStats'],
    },
    {
      name: 'pm.bulk_create_positions',
      description: 'PM 在项目下批量创建岗位 (单次事务).',
      method: 'POST', path: '/v1/pm/projects/:projectId/positions/bulk',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.insertBatch'],
    },

    // ----- Staffing Plans -----
    {
      name: 'pm.create_staffing_plan',
      description: 'PM 为项目创建 staffing 方案 (草稿).',
      method: 'POST', path: '/v1/pm/projects/:projectId/plans',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.staffing_plans.insert'],
    },
    {
      name: 'pm.list_staffing_plans',
      description: 'PM 列出项目下的所有 staffing 方案.',
      method: 'GET', path: '/v1/pm/projects/:projectId/plans',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.staffing_plans.listByProject'],
    },
    {
      name: 'pm.read_plan',
      description: 'PM 读取单个 staffing plan 详情.',
      method: 'GET', path: '/v1/pm/plans/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.staffing_plans.findById'],
    },
    {
      name: 'pm.update_plan',
      description: 'PM 更新 staffing plan.',
      method: 'PATCH', path: '/v1/pm/plans/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.staffing_plans.update'],
    },
    {
      name: 'pm.delete_plan',
      description: 'PM 删除 staffing plan.',
      method: 'DELETE', path: '/v1/pm/plans/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.staffing_plans.delete'],
    },
    {
      name: 'pm.select_staffing_plan',
      description: 'PM 把某个 staffing plan 标记为 selected (取消其他方案的 selected 状态).',
      method: 'POST', path: '/v1/pm/plans/:id/select',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.staffing_plans.update(is_selected)', 'db.staffing_plans.unselectOthers'],
      // R1.C4: ow-recruit's "advance-candidate" skill — selecting a
      // staffing plan advances the candidate through the PM pipeline.
      // Path bound to the REAL /v1/pm/plans/:id/select route (the
      // earlier /staffing-plans/ declaration was wrong — the route
      // never existed).
      aliases: ['ow_recruit.advance_candidate'],
    },

    // ----- Decompositions -----
    {
      name: 'pm.decompose_position',
      description: 'PM 把一段自然语言需求文本拆解为岗位列表 (AI heuristic 驱动).',
      method: 'POST', path: '/v1/pm/projects/:projectId/decompose',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.position_decompositions.insert', 'ai.heuristic.decompose'],
    },
    {
      name: 'pm.commit_decomposition',
      description: 'PM 把一次 decompose 结果正式提交 (固化为 positions).',
      method: 'POST', path: '/v1/pm/projects/:projectId/decompose/:decompositionId/commit',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.project_positions.bulkInsertFromDecomposition'],
    },
    {
      name: 'pm.list_decompositions',
      description: 'PM 列出项目的所有历史拆解.',
      method: 'GET', path: '/v1/pm/projects/:projectId/decompositions',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.position_decompositions.listByProject'],
    },

    // ----- Matches -----
    {
      name: 'pm.match_candidates',
      description: 'PM 触发候选人与岗位的匹配打分 (后台 async 计算).',
      method: 'POST', path: '/v1/pm/positions/:id/matches/recompute',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.matches.upsertBatch', 'db.matches.score'],
    },
    {
      name: 'pm.list_matches',
      description: 'PM 列出岗位的候选匹配 (按 score DESC).',
      method: 'GET', path: '/v1/pm/positions/:id/matches',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.matches.listByPosition'],
    },
    {
      name: 'pm.position_sandbox',
      description: 'PM 查 position 的脱敏 sandbox 数据预览.',
      method: 'GET', path: '/v1/pm/positions/:id/sandbox',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.matches.listByPositionForSandbox'],
    },

    // ----- Snapshot -----
    {
      name: 'pm.snapshot',
      description: 'PM 全局快照 (projects/positions/plans/matches 计数).',
      method: 'GET', path: '/v1/pm/snapshot',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.pm.snapshotCounters'],
    },

    // ----- PM Notes (per-PM private notes on candidates) -----
    {
      name: 'pm.write_note',
      description: 'PM 在候选人上写 / 更新私人备注.同时支持切换 starred (PUT body 含 { starred: true|false }).',
      method: 'PUT', path: '/v1/pm/notes/:candidate_user_id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.pm_notes.upsert(starred, note_text)'],
    },
    {
      name: 'pm.read_note',
      description: 'PM 读取某候选人的私人备注.',
      method: 'GET', path: '/v1/pm/notes/:candidate_user_id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.pm_notes.findByPmAndCandidate'],
    },
    {
      name: 'pm.list_notes',
      description: 'PM 列出自己写过的所有备注 (按 updated_at DESC).',
      method: 'GET', path: '/v1/pm/notes',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.pm_notes.listByPm'],
    },
    {
      // The /star subendpoint never existed as a separate route — starring
      // is folded into PUT /v1/pm/notes/:candidate_user_id (the
      // { starred: bool } body field). Restated here as a discoverable
      // capability name so /v1/capabilities surfaces it.
      name: 'pm.star_candidate',
      description: 'PM 收藏 / 取消收藏候选人 (通过 PUT /v1/pm/notes/:candidate_user_id body { starred: bool }).',
      method: 'PUT', path: '/v1/pm/notes/:candidate_user_id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.pm_notes.update(starred)'],
    },
  ],
});