import { contextBridge, ipcRenderer } from 'electron';

/**
 * IPC channel type definitions (must stay in sync with src/main/ipc/*).
 * The renderer never calls ipcRenderer directly; everything goes through this
 * typed `window.api` surface so the contextBridge sandbox stays intact.
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  // === Admin ===
  admin: {
    dashboard: {
      getStats: (): Promise<{ ok: boolean; data?: any; error?: any }> =>
        ipcRenderer.invoke('admin:dashboard:getStats'),
    },
    users: {
      list: (filter: { user_type?: string; status?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:users:list', filter),
      suspend: (user_id: string, reason: string): Promise<any> =>
        ipcRenderer.invoke('admin:users:suspend', { user_id, reason }),
      unsuspend: (user_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:users:unsuspend', { user_id }),
      adjustQuota: (user_id: string, new_quota: number): Promise<any> =>
        ipcRenderer.invoke('admin:users:adjustQuota', { user_id, new_quota }),
    },
    candidates: {
      list: (filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:candidates:list', filter),
      removeFromPool: (anonymized_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:candidates:removeFromPool', { anonymized_id }),
    },
    audit: {
      list: (filter: { actor_user_id?: string; recommendation_id?: string; limit?: number }): Promise<any> =>
        ipcRenderer.invoke('admin:audit:list', filter),
    },
    webhooks: {
      listDeadLetter: (limit?: number): Promise<any> =>
        ipcRenderer.invoke('admin:webhooks:listDeadLetter', { limit }),
      retry: (delivery_id: number): Promise<any> =>
        ipcRenderer.invoke('admin:webhooks:retry', { delivery_id }),
    },
    rateLimit: {
      listBuckets: (user_id?: string): Promise<any> =>
        ipcRenderer.invoke('admin:rateLimit:listBuckets', { user_id }),
      clearForUser: (user_id: string): Promise<any> =>
        ipcRenderer.invoke('admin:rateLimit:clearForUser', { user_id }),
    },
    config: {
      get: (): Promise<any> => ipcRenderer.invoke('admin:config:get'),
      set: (key: string, value: any): Promise<any> =>
        ipcRenderer.invoke('admin:config:set', { key, value }),
    },
  },
} as const;

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;