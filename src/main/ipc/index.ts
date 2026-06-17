import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { getDb } from '../db.js';
import { makeDashboardIpc } from './dashboard.js';
import { createUsersIpc } from './users.js';
import { createCandidatesIpc } from './candidates.js';
import { createAuditIpc } from './audit.js';
import { createWebhooksIpc } from './webhooks.js';
import { createRateLimitIpc } from './rate-limit.js';
import { createConfigIpc } from './config.js';
import { createPlacementsIpc } from './placements.js';
import { createAdminLogIpc } from './admin-log.js';

let registered = false;

/**
 * Wire all admin IPC channels to their handlers.
 * Idempotent — safe to call multiple times (only first call wires handlers).
 */
export function registerAdminIpc(): void {
  if (registered) return;
  registered = true;

  const db = getDb();
  const dashboard = makeDashboardIpc(db);
  const users = createUsersIpc(db);
  const candidates = createCandidatesIpc(db);
  const audit = createAuditIpc(db);
  const webhooks = createWebhooksIpc(db);
  const rateLimit = createRateLimitIpc(db);
  const config = createConfigIpc();
  const placements = createPlacementsIpc(db);
  const adminLog = createAdminLogIpc(db);

  ipcMain.handle('admin:ping', () => 'admin pong');

  ipcMain.handle('admin:dashboard:getStats', () => dashboard.getStats());

  ipcMain.handle('admin:users:list', (_e, filter) => users.list(filter ?? {}));
  ipcMain.handle('admin:users:suspend', (_e, args) => users.suspend(args.user_id, args.reason));
  ipcMain.handle('admin:users:unsuspend', (_e, args) => users.unsuspend(args.user_id));
  ipcMain.handle('admin:users:adjustQuota', (_e, args) => users.adjustQuota(args.user_id, args.new_quota));

  ipcMain.handle('admin:candidates:list', (_e, filter) => candidates.list(filter ?? {}));
  ipcMain.handle('admin:candidates:removeFromPool', (_e, args) => candidates.removeFromPool(args.anonymized_id));

  ipcMain.handle('admin:audit:list', (_e, filter) => audit.list(filter ?? {}));

  ipcMain.handle('admin:webhooks:listDeadLetter', (_e, args) => webhooks.listDeadLetter(args?.limit ?? 50));
  ipcMain.handle('admin:webhooks:retry', (_e, args) => webhooks.retry(args.delivery_id));

  ipcMain.handle('admin:rateLimit:listBuckets', (_e, args) => rateLimit.listBuckets(args?.user_id));
  ipcMain.handle('admin:rateLimit:clearForUser', (_e, args) => rateLimit.clearForUser(args.user_id));

  ipcMain.handle('admin:config:get', () => config.get());
  ipcMain.handle('admin:config:set', (_e, args) => config.set(args.key, args.value));

  ipcMain.handle('admin:placements:list', (_e, filter) => placements.list(filter ?? {}));
  ipcMain.handle('admin:placements:markPaid', (_e, args) => placements.markPaid('admin', args.placement_id));
  ipcMain.handle('admin:placements:cancel', (_e, args) => placements.cancel('admin', args.placement_id));
  ipcMain.handle('admin:placements:summary', () => placements.summary());

  ipcMain.handle('admin:adminLog:list', (_e, filter) => adminLog.list(filter ?? {}));
}

/**
 * Wrap an IPC handler with try/catch so renderer gets { ok: false, error }
 * instead of an unhandled rejection. Returned data is wrapped as { ok, data }.
 */
export function withErrorHandling<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    try {
      return { ok: true, data: await handler(event, ...(args as T)) };
    } catch (e: any) {
      console.error(`[IPC ${channel}]`, e);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: e?.message ?? String(e) } };
    }
  });
}