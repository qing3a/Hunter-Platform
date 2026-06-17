/// <reference types="vite/client" />

interface AdminApi {
  dashboard: {
    getStats(): Promise<{ ok: boolean; data?: any; error?: any }>;
  };
  users: {
    list(filter: { user_type?: string; status?: string; limit?: number }): Promise<any>;
    suspend(user_id: string, reason: string): Promise<any>;
    unsuspend(user_id: string): Promise<any>;
    adjustQuota(user_id: string, new_quota: number): Promise<any>;
  };
  candidates: {
    list(filter: { in_pool?: boolean; unlock_status?: string; limit?: number }): Promise<any>;
    removeFromPool(anonymized_id: string): Promise<any>;
  };
  audit: {
    list(filter: { actor_user_id?: string; recommendation_id?: string; limit?: number }): Promise<any>;
  };
  webhooks: {
    listDeadLetter(limit?: number): Promise<any>;
    retry(delivery_id: number): Promise<any>;
  };
  rateLimit: {
    listBuckets(user_id?: string): Promise<any>;
    clearForUser(user_id: string): Promise<any>;
  };
  config: {
    get(): Promise<any>;
    set(key: string, value: any): Promise<any>;
  };
}

interface ConvoApi {
  ping(): Promise<string>;
  admin: AdminApi;
}

declare global {
  interface Window {
    api: ConvoApi;
  }
}

export {};