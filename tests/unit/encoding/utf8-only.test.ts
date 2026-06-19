import { describe, it, expect } from 'vitest';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/utf8-only';

function fakeRes() {
  let statusCode = 200;
  let body: any = null;
  return {
    status: (c: number) => { statusCode = c; return { json: (b: any) => { body = b; } }; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  } as any;
}

function runMw(method: string, contentType: string | undefined): { next: boolean; status: number; body: any } {
  const mw = createUtf8OnlyMiddleware();
  const req: any = { method, headers: contentType !== undefined ? { 'content-type': contentType } : {} };
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { next: nextCalled, status: res.statusCode, body: res.body };
}

describe('utf8-only middleware', () => {
  it('allows POST with application/json; charset=utf-8', () => {
    const r = runMw('POST', 'application/json; charset=utf-8');
    expect(r.next).toBe(true);
    expect(r.status).toBe(200);
  });

  it('rejects POST with application/json (no charset)', () => {
    const r = runMw('POST', 'application/json');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CHARSET');
  });

  it('rejects POST with application/json; charset=gbk', () => {
    const r = runMw('POST', 'application/json; charset=gbk');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects POST with text/plain', () => {
    const r = runMw('POST', 'text/plain; charset=utf-8');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects POST with no Content-Type header', () => {
    const r = runMw('POST', undefined);
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
  });

  it('skips GET', () => {
    const r = runMw('GET', undefined);
    expect(r.next).toBe(true);
  });

  it('skips DELETE', () => {
    const r = runMw('DELETE', undefined);
    expect(r.next).toBe(true);
  });

  it('accepts charset in any case (case-insensitive)', () => {
    const r = runMw('POST', 'application/json; CHARSET=UTF-8');
    expect(r.next).toBe(true);
  });

  it('accepts charset=utf8 (no dash)', () => {
    const r = runMw('POST', 'application/json; charset=utf8');
    expect(r.next).toBe(true);
  });
});