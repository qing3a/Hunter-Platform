import { describe, it, expect } from 'vitest';
import { createUtf8OnlyMiddleware } from '../../../src/main/modules/encoding/utf8-only';

/**
 * The middleware now buffers the request body to validate raw bytes.
 * For unit tests we provide a fake `req` whose `on()` synchronously
 * fires `end` with empty data. That's enough to exercise the
 * Content-Type / charset / UTF-8-detection paths without a real stream.
 */
function fakeReq(method: string, contentType: string | undefined, rawBody?: Buffer): any {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    method,
    headers: contentType !== undefined ? { 'content-type': contentType } : {},
    on(event: string, fn: (...args: unknown[]) => void) {
      (handlers[event] ||= []).push(fn);
      return this;
    },
    destroy() { /* noop for test fake */ },
    _emit(event: string, ...args: unknown[]) {
      (handlers[event] || []).forEach(fn => fn(...args));
    },
    _triggerEmptyEnd() {
      // Simulate an HTTP request with no body
      this._emit('end');
    },
    _triggerBody(buf: Buffer) {
      this._emit('data', buf);
      this._emit('end');
    },
  };
}

function fakeRes() {
  let statusCode = 200;
  let body: any = null;
  let headersSent = false;
  return {
    headersSent,
    status: (c: number) => { statusCode = c; headersSent = true; return { json: (b: any) => { body = b; } }; },
    get statusCode() { return statusCode; },
    get body() { return body; },
    _markSent() { headersSent = true; },
  } as any;
}

function runMw(method: string, contentType: string | undefined, rawBody?: Buffer): { next: boolean; status: number; body: any } {
  const mw = createUtf8OnlyMiddleware();
  const req = fakeReq(method, contentType, rawBody);
  const res = fakeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  if (rawBody !== undefined) req._triggerBody(rawBody);
  else req._triggerEmptyEnd();
  return { next: nextCalled, status: res.statusCode, body: res.body };
}

describe('utf8-only middleware', () => {
  it('allows POST with application/json; charset=utf-8 (empty body)', () => {
    const r = runMw('POST', 'application/json; charset=utf-8');
    expect(r.next).toBe(true);
    expect(r.status).toBe(200);
  });

  it('accepts POST with application/json (no charset) — defaults to UTF-8 (RFC 8259)', () => {
    const r = runMw('POST', 'application/json');
    expect(r.next).toBe(true);
    expect(r.status).toBe(200);
  });

  it('rejects POST with application/json; charset=gbk', () => {
    const r = runMw('POST', 'application/json; charset=gbk');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CHARSET');
  });

  it('rejects POST with text/plain', () => {
    const r = runMw('POST', 'text/plain; charset=utf-8');
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('accepts POST with no Content-Type header (empty body)', () => {
    const r = runMw('POST', undefined);
    expect(r.next).toBe(true);
    expect(r.status).toBe(200);
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

  // ---- New: actual byte validation ----

  it('accepts POST with valid UTF-8 body containing Chinese', () => {
    const body = Buffer.from('{"name":"张三"}', 'utf8');
    const r = runMw('POST', 'application/json; charset=utf-8', body);
    expect(r.next).toBe(true);
    expect(r.status).toBe(200);
  });

  it('rejects POST with non-UTF-8 bytes (raw 字节 in GBK)', () => {
    // "字节跳动" in GBK = d7 d6 bd da cc f8 (not valid UTF-8)
    const gbkBody = Buffer.from([0xd7, 0xd6, 0xbd, 0xda, 0xcc, 0xf8]);
    const r = runMw('POST', 'application/json; charset=utf-8', gbkBody);
    expect(r.next).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CHARSET');
  });

  it('flags suspected GBK with helpful details when GBK trail byte found', () => {
    // GBK trail-byte in 0x40-0x7E range followed by ASCII printable
    // 字节跳动 in GBK has d7 d6 (lead+digit) which fits the heuristic
    const gbkBody = Buffer.from([0xd7, 0xd6, 0xbd, 0x44, 0xcc, 0xf8]);
    const r = runMw('POST', 'application/json', gbkBody);
    expect(r.next).toBe(false);
    expect(r.body.error.details?.suspected_charset).toBe('GBK/GB18030');
  });

  it('rejects body exceeding 4KB limit', () => {
    const big = Buffer.alloc(5 * 1024, 'a');
    const r = runMw('POST', 'application/json', big);
    expect(r.next).toBe(false);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('parses valid JSON body and sets req.body', async () => {
    const mw = createUtf8OnlyMiddleware();
    const req = fakeReq('POST', 'application/json');
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    req._triggerBody(Buffer.from('{"a":1,"b":"hi"}', 'utf8'));
    // microtask boundary for the end handler
    await new Promise(r => setImmediate(r));
    expect(nextCalled).toBe(true);
    expect(req.body).toEqual({ a: 1, b: 'hi' });
  });

  it('rejects body that is valid UTF-8 but not valid JSON', async () => {
    const mw = createUtf8OnlyMiddleware();
    const req = fakeReq('POST', 'application/json');
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    req._triggerBody(Buffer.from('not json', 'utf8'));
    await new Promise(r => setImmediate(r));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});