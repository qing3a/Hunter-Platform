import { defineCapabilitySet } from './types.js';

/**
 * Candidate Portal (Phase 1) — C 端候选人自助门户 capabilities.
 * Routes: /v1/candidate-portal/*
 *
 * Phase 1 能力:
 *  - 邮箱 OTP 注册/登录 (unauth)
 *  - 浏览/查看/申请工作
 *  - 我的申请 + 撤回
 *  - 候选人 ↔ 猎头/雇主消息
 *  - 简历查看 (公开 + PII 只读副本) + 公开字段编辑 + 审计
 */
export const candidatePortalCapabilities = defineCapabilitySet({
  role: 'candidate',
  capabilities: [
    {
      name: 'candidate_portal.auth.request_otp',
      description: '候选人请求 OTP 验证码',
      method: 'POST', path: '/v1/candidate-portal/auth/otp/request',
      quota_cost: 0,
      preconditions: [],
      effects: ['db.candidate_otp_codes.insert', 'email.send(otp)'],
    },
    {
      name: 'candidate_portal.auth.verify_otp',
      description: '候选人验证 OTP 并签发 bearer token',
      method: 'POST', path: '/v1/candidate-portal/auth/otp/verify',
      quota_cost: 0,
      preconditions: [],
      effects: ['db.candidate_otp_codes.markConsumed', 'db.users.upsert(candidate)', 'issue_api_key'],
    },

    {
      name: 'candidate_portal.jobs.browse',
      description: '候选人浏览全部开放工作',
      method: 'GET', path: '/v1/candidate-portal/jobs/browse',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.jobs.listOpen'],
    },
    {
      name: 'candidate_portal.jobs.view',
      description: '候选人查看工作详情',
      method: 'GET', path: '/v1/candidate-portal/jobs/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.jobs.findById'],
    },
    {
      name: 'candidate_portal.jobs.apply',
      description: '候选人申请工作 (创建 pending_pickup 推荐)',
      method: 'POST', path: '/v1/candidate-portal/jobs/:id/apply',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.recommendations.insert(source_type=candidate_self_apply, status=pending_pickup)', 'db.candidate_applications.insert', 'webhook: notify_pending_pickup'],
    },

    {
      name: 'candidate_portal.applications.list',
      description: '候选人查看我的申请列表',
      method: 'GET', path: '/v1/candidate-portal/applications',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidate_applications.listByCandidate'],
    },
    {
      name: 'candidate_portal.applications.detail',
      description: '候选人查看单个投递详情',
      method: 'GET', path: '/v1/candidate-portal/applications/:id',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidate_applications.findById'],
    },
    {
      name: 'candidate_portal.applications.respond',
      description: '候选人撤回/接受/拒绝',
      method: 'POST', path: '/v1/candidate-portal/applications/:id/respond',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidate_applications.update(withdrawn_at)'],
    },

    {
      name: 'candidate_portal.messages.send',
      description: '候选人发送消息',
      method: 'POST', path: '/v1/candidate-portal/messages',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidate_messages.insert', 'webhook: notify_message'],
      // R1.C4: ow-recruit's "send-message" skill — direct 1:1 mapping.
      aliases: ['ow_recruit.send_message'],
    },
    {
      name: 'candidate_portal.messages.list',
      description: '候选人读取消息',
      method: 'GET', path: '/v1/candidate-portal/messages',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidate_messages.listByUser'],
    },

    {
      name: 'candidate_portal.profile.view',
      description: '候选人查看简历 (公开 + PII 只读)',
      method: 'GET', path: '/v1/candidate-portal/profile',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidates_anonymized.getByUser', 'db.candidates_private.getPiiReadonly'],
    },
    {
      name: 'candidate_portal.profile.edit_public',
      description: '候选人编辑公开字段 (技能/期望/可见性)',
      method: 'PUT', path: '/v1/candidate-portal/profile',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.candidates_anonymized.update(public_fields)'],
    },
    {
      name: 'candidate_portal.profile.view_audit',
      description: '候选人查看简历审计日志',
      method: 'GET', path: '/v1/candidate-portal/profile/audit-log',
      quota_cost: 0,
      preconditions: ['user.status === "active"'],
      effects: ['db.unlock_audit_log.listByCandidate'],
    },
  ],
});

/** Flat list of candidate portal capabilities (for spread/iteration). */
export const CANDIDATE_PORTAL_CAPABILITIES = candidatePortalCapabilities.capabilities;
