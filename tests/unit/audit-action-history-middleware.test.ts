import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createActionHistoryMiddleware } from '../../src/main/modules/audit/action-history-middleware.js';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    path: '/v1/auth/register',
    user: { id: 'user_test' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res: any = {
    statusCode: 200,
    locals: {},
    on(event: string, cb: () => void) { if (event === 'finish') (res as any)._finishCb = cb; return res; },
  };
  return res as Response;
}

describe('action_history middleware', () => {
  let insertMock: any;
  let middleware: any;

  beforeEach(() => {
    insertMock = vi.fn();
    middleware = createActionHistoryMiddleware({ insert: insertMock } as any);
  });

  it('calls next()', () => {
    const next = vi.fn();
    middleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('writes success entry on res.finish with 200', () => {
    const res = mockRes();
    middleware(mockReq(), res, vi.fn());
    res.statusCode = 200;
    (res as any)._finishCb();
    expect(insertMock).toHaveBeenCalledTimes(1);
    const entry = insertMock.mock.calls[0][0];
    expect(entry.user_id).toBe('user_test');
    expect(entry.capability_name).toBe('auth.register');
    expect(entry.status).toBe('success');
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('writes error entry with error_code from res.locals', () => {
    const res = mockRes();
    res.locals.errorCode = 'RATE_LIMITED';
    middleware(mockReq(), res, vi.fn());
    res.statusCode = 429;
    (res as any)._finishCb();
    const entry = insertMock.mock.calls[0][0];
    expect(entry.status).toBe('error');
    expect(entry.error_code).toBe('RATE_LIMITED');
  });

  it('uses ahTargetType/ahTargetId/ahResSummary from res.locals', () => {
    const res = mockRes();
    res.locals.ahTargetType = 'candidate';
    res.locals.ahTargetId = 'ca_123';
    res.locals.ahResSummary = { anonymized_id: 'ca_123', industry: '互联网' };
    middleware(mockReq({ path: '/v1/headhunter/candidates' } as any), res, vi.fn());
    (res as any)._finishCb();
    const entry = insertMock.mock.calls[0][0];
    expect(entry.target_type).toBe('candidate');
    expect(entry.target_id).toBe('ca_123');
    expect(JSON.parse(entry.response_summary_json)).toEqual({ anonymized_id: 'ca_123', industry: '互联网' });
  });

  it('does NOT write when req.user is missing (e.g. unauthenticated)', () => {
    const req = mockReq({ user: undefined } as any);
    const res = mockRes();
    middleware(req, res, vi.fn());
    // 显式 trigger finish — 即使 res 完成也不应该写
    (res as any)._finishCb();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('uses res.locals.userIdForAudit when req.user is missing (e.g. /auth/register)', () => {
    const req = mockReq({ user: undefined } as any);
    const res = mockRes();
    res.locals.userIdForAudit = 'user_newly_registered';
    middleware(req, res, vi.fn());
    (res as any)._finishCb();
    const entry = insertMock.mock.calls[0][0];
    expect(entry.user_id).toBe('user_newly_registered');
    expect(entry.capability_name).toBe('auth.register');
  });

  it('does NOT throw when insert fails (fire-and-forget)', () => {
    insertMock.mockImplementation(() => { throw new Error('db locked'); });
    const res = mockRes();
    middleware(mockReq(), res, vi.fn());
    expect(() => (res as any)._finishCb()).not.toThrow();
  });

  it('does NOT write PII when res.locals.ahResSummary has forbidden keys', () => {
    const res = mockRes();
    res.locals.ahResSummary = { user_name: '张三' };
    middleware(mockReq(), res, vi.fn());
    (res as any)._finishCb();
    // 应该 throw 但被中间件 catch 住
    expect(insertMock).not.toHaveBeenCalled();
  });
});