import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * Placeholder — full IPC handlers wired in subsequent M3.B tasks.
 * Lives here so `src/main/index.ts` can import it without errors.
 */
export function registerAdminIpc(): void {
  ipcMain.handle('admin:ping', () => 'admin pong');
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