import { defineCapabilitySet } from './types.js';
import {
  ListOpportunitiesResponseSchema, AccessLogResponseSchema,
  ExportMyDataResponseSchema, ApproveUnlockResponseSchema,
  RejectUnlockResponseSchema, DeleteMyDataResponseSchema,
} from '../schemas/candidate.js';
import { QUOTA_COSTS } from '../../shared/constants.js';

export const candidateCapabilities = defineCapabilitySet({
  role: 'candidate',
  capabilities: [
    {
      name: 'candidate.view_opportunities',
      description: '列出所有雇主对我表达过兴趣的推荐(解锁请求列表)。',
      method: 'GET', path: '/v1/candidate/opportunities',
      response_schema: ListOpportunitiesResponseSchema,
      quota_cost: QUOTA_COSTS.view_opportunities,
      preconditions: ['user.status === "active"'],
      effects: ['consume_quota(1)', 'db.recommendations.listByCandidate'],
    },
    {
      name: 'candidate.access_log',
      description: '查询谁看过我的脱敏数据(解锁审计日志)。',
      method: 'GET', path: '/v1/candidate/access-log',
      response_schema: AccessLogResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.unlock_audit.listByCandidate'],
    },
    {
      name: 'candidate.export_my_data',
      description: '导出我所有个人数据(GDPR data portability)。',
      method: 'GET', path: '/v1/candidate/export-my-data',
      response_schema: ExportMyDataResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.dump.candidate'],
    },
    {
      name: 'candidate.approve_unlock',
      description: '批准雇主解锁我的联系方式(状态: employer_interested → candidate_approved)。',
      method: 'POST', path: '/v1/candidate/recommendations/:id/approve-unlock',
      response_schema: ApproveUnlockResponseSchema,
      quota_cost: QUOTA_COSTS.approve_unlock,
      preconditions: ['user.status === "active"', 'flow.recommendation.approve_unlock'],
      effects: ['consume_quota(3)', 'webhook: notify_unlock_approved'],
    },
    {
      name: 'candidate.reject_unlock',
      description: '拒绝雇主解锁我的联系方式。',
      method: 'POST', path: '/v1/candidate/recommendations/:id/reject-unlock',
      response_schema: RejectUnlockResponseSchema,
      quota_cost: QUOTA_COSTS.reject_unlock,
      preconditions: ['user.status === "active"', 'flow.recommendation.reject_candidate'],
      effects: ['consume_quota(1)', 'db.recommendations.updateStatus(rejected_candidate)'],
    },
    {
      name: 'candidate.delete_my_data',
      description: 'GDPR right-to-be-forgotten(清空 PII,保留脱敏数据)。',
      method: 'POST', path: '/v1/candidate/delete-my-data',
      response_schema: DeleteMyDataResponseSchema,
      quota_cost: 0,
      preconditions: ['user.status === "active"', 'flow.user.delete'],
      effects: ['db.candidates_private.clear', 'db.users.markDeleted'],
    },
  ],
});