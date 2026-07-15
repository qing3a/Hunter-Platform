import { defineCapabilitySet } from './types.js';

/**
 * Inbound Webhook (R1.C3) — ow-recruit relay 推事件过来.
 * 路由: POST /v1/webhooks/qing3
 *
 * HMAC-verified; body-hash dedup'd against webhook_inbox_deliveries 表 (R1.C3
 * 引入)。这条 capability 不属于任何 user role —— 它是 machine-to-machine。
 * 由于 CapabilitySet.role 类型只有 'candidate' | 'hr' | 'pm' | 'admin' | 'auth'，
 * 没有 'system' 这一档；目前以 'admin' 作为最近似的标识（admin 也是机器 / 后台
 * 概念，不与用户行为混类）。已知 type-fidelity 缺陷，后续可加 'system' enum 值。
 */
export const webhooksInboxCapabilities = defineCapabilitySet({
  role: 'admin',  // 'system' not in the type union yet
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
