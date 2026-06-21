import { describe, it, expect, vi } from 'vitest';
import { respond, EnvelopeSchema } from '../../src/main/responses';
import { z } from 'zod';

describe('respond()', () => {
  it('validates payload against schema and calls res.json with parsed value', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string(), count: z.number() }));
    const res = { json: vi.fn() } as any;
    respond(res, schema, { ok: true, data: { id: 'x', count: 3 } });
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { id: 'x', count: 3 } });
  });

  it('throws ZodError when payload does not match schema', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string() }));
    const res = { json: vi.fn() } as any;
    expect(() => respond(res, schema, { ok: true, data: { id: 123 } } as any)).toThrow();
  });

  it('strips extra fields when opts.strict is false (default)', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string() }));
    const res = { json: vi.fn() } as any;
    respond(res, schema, { ok: true, data: { id: 'x', extra: 'leak' } } as any);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { id: 'x' } });
  });

  it('rejects extra fields when opts.strict is true', () => {
    const schema = EnvelopeSchema(z.object({ id: z.string() }));
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { id: 'x', extra: 'leak' } } as any, { strict: true })
    ).toThrow();
  });
});