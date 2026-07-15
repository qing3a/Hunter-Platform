import { defineCapabilitySet } from './types.js';

/**
 * Inbound Webhook (R1.C3) — ow-recruit relay 推事件过来.
 * 路由: POST /v1/webhooks/qing3
 *
 * HMAC-verified; body-hash dedup'd against webhook_inbox_deliveries 表 (R1.C3
 * 引入)。这条 capability 不属于任何 user role —— 它是 machine-to-machine。
 * CapabilitySet.role 类型已扩展含 'system' (PR #4)，所以这里用 'system' 准确表达。
 */
export const webhooksInboxCapabilities = defineCapabilitySet({
  role: 'system',
  capabilities: [
    {
      name: 'webhooks.qing3_receive',
      description: 'ow-recruit relay 入站 webhook 接收 (HMAC + body-hash 去重, ±5min 重放窗)。',
      method: 'POST', path: '/v1/webhooks/qing3',
      quota_cost: 0,
      preconditions: [],
      effects: ['db.webhook_inbox_deliveries.insertOrIgnore'],
    },
  ],
});
