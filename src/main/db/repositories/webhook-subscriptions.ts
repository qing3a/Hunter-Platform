import type { DB } from '../connection.js';

export type WebhookSubscriptionRow = {
  id: number;
  target_url: string;
  event_types: string;
  hmac_secret: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  created_by_admin_user_id: string | null;
};

export type WebhookSubscription = {
  id: number;
  target_url: string;
  event_types: string[];
  hmac_secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by_admin_user_id: string | null;
};

const rowToSubscription = (r: WebhookSubscriptionRow): WebhookSubscription => ({
  id: r.id,
  target_url: r.target_url,
  event_types: JSON.parse(r.event_types),
  hmac_secret: r.hmac_secret,
  enabled: r.enabled === 1,
  created_at: r.created_at,
  updated_at: r.updated_at,
  created_by_admin_user_id: r.created_by_admin_user_id,
});

export function createWebhookSubscriptionsRepo(db: DB) {
  return {
    list(): WebhookSubscription[] {
      const rows = db.prepare('SELECT * FROM webhook_subscriptions ORDER BY id ASC').all() as WebhookSubscriptionRow[];
      return rows.map(rowToSubscription);
    },
    findById(id: number): WebhookSubscription | null {
      const row = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id) as WebhookSubscriptionRow | undefined;
      return row ? rowToSubscription(row) : null;
    },
    create(data: { target_url: string; event_types: string[]; hmac_secret: string | null; created_by_admin_user_id: string | null }): WebhookSubscription {
      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO webhook_subscriptions (target_url, event_types, hmac_secret, enabled, created_at, updated_at, created_by_admin_user_id)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(data.target_url, JSON.stringify(data.event_types), data.hmac_secret, now, now, data.created_by_admin_user_id);
      const id = Number(result.lastInsertRowid);
      return this.findById(id)!;
    },
    update(id: number, data: Partial<{ target_url: string; event_types: string[]; hmac_secret: string | null; enabled: boolean }>): WebhookSubscription {
      const fields: string[] = [];
      const values: any[] = [];
      if (data.target_url !== undefined) { fields.push('target_url = ?'); values.push(data.target_url); }
      if (data.event_types !== undefined) { fields.push('event_types = ?'); values.push(JSON.stringify(data.event_types)); }
      if (data.hmac_secret !== undefined) { fields.push('hmac_secret = ?'); values.push(data.hmac_secret); }
      if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
      fields.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);
      db.prepare(`UPDATE webhook_subscriptions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return this.findById(id)!;
    },
    delete(id: number): void {
      db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(id);
    },
  };
}
