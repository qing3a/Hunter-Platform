export type UserRole = 'candidate' | 'headhunter' | 'employer';

export interface AgentContext {
  baseUrl: string;
  userIds: { candidate?: string; headhunter?: string; employer?: string };
  apiKeys: { candidate?: string; headhunter?: string; employer?: string };
  resources: {
    anonymized_id?: string;
    job_id?: string;
    recommendation_id?: string;
    view_token_audit?: string;
    view_token_recommendation?: string;
  };
}

export interface RequestResult {
  status: number;
  data: any;
  raw: string;
}

export class ApiClient {
  constructor(public ctx: AgentContext) {}

  async request(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    asUser?: UserRole;
    query?: Record<string, string>;
  }): Promise<RequestResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (opts.asUser) {
      const key = this.ctx.apiKeys[opts.asUser];
      if (!key) throw new Error(`No API key for ${opts.asUser}`);
      headers.Authorization = `Bearer ${key}`;
    }
    let url = `${this.ctx.baseUrl}${opts.path}`;
    if (opts.query) url += `?${new URLSearchParams(opts.query).toString()}`;
    const res = await fetch(url, { method: opts.method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const raw = await res.text();
    let data: any = null;
    if (raw) { try { data = JSON.parse(raw); } catch { /* null */ } }
    return { status: res.status, data, raw };
  }
}
