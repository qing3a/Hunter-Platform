/**
 * Hunter Platform HTTP client.
 *
 * Thin wrapper around fetch that:
 *   - Adds Authorization header when api_key is provided
 *   - Sends Content-Type: application/json; charset=utf-8
 *   - Translates Hunter Platform's {ok, data} / {ok, error} envelope into either:
 *       - parsed JSON (on success)
 *       - thrown HunterApiError (on platform error)
 *       - thrown HunterHttpError (on network/HTTP error)
 */
import { resolveBaseUrl } from './auth.js';

export class HunterApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HunterApiError';
  }
}

export class HunterHttpError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'HunterHttpError';
  }
}

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class HunterClient {
  readonly apiKey: string | undefined;
  readonly baseUrl: string;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? resolveBaseUrl()).replace(/\/$/, '');
  }

  async get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    return this.request<T>('GET', url);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new HunterHttpError(
        `Network error calling ${method} ${url}: ${(err as Error).message}`,
        0,
      );
    }

    let parsed: unknown;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      throw new HunterHttpError(
        `Non-JSON response from ${method} ${url} (HTTP ${res.status}): ${text.slice(0, 200)}`,
        res.status,
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new HunterHttpError(
        `Unexpected response shape from ${method} ${url}`,
        res.status,
      );
    }

    const env = parsed as { ok?: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };
    if (env.ok === true) {
      return env.data as T;
    }
    if (env.ok === false && env.error) {
      throw new HunterApiError(env.error.code, env.error.message, res.status, env.error.details);
    }
    throw new HunterHttpError(
      `Malformed envelope from ${method} ${url}`,
      res.status,
    );
  }
}

/**
 * Format an Error into a JSON string suitable for MCP tool error responses.
 */
export function formatToolError(err: unknown): string {
  if (err instanceof HunterApiError) {
    return JSON.stringify({
      error: err.code,
      message: err.message,
      http_status: err.httpStatus,
      details: err.details,
    }, null, 2);
  }
  if (err instanceof HunterHttpError) {
    return JSON.stringify({
      error: 'HTTP_ERROR',
      message: err.message,
      http_status: err.httpStatus,
    }, null, 2);
  }
  return JSON.stringify({
    error: 'INTERNAL_ERROR',
    message: (err as Error).message ?? String(err),
  }, null, 2);
}