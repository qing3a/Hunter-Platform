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

  it('strict mode rejects extra fields in nested arrays', () => {
    const schema = EnvelopeSchema(z.array(z.object({ id: z.string() })));
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: [{ id: 'x', leak: true }] } as any, { strict: true })
    ).toThrow();
  });

  it('strict mode rejects extra fields in union object branches', () => {
    const schema = EnvelopeSchema(
      z.union([
        z.object({ kind: z.literal('a'), a: z.string() }),
        z.object({ kind: z.literal('b'), b: z.number() }),
      ])
    );
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { kind: 'a', a: 'x', leak: true } } as any, { strict: true })
    ).toThrow();
  });

  it('strict mode rejects extra fields in discriminated union branches', () => {
    const schema = EnvelopeSchema(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), a: z.string() }),
        z.object({ kind: z.literal('b'), b: z.number() }),
      ])
    );
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { kind: 'b', b: 7, leak: 'x' } } as any, { strict: true })
    ).toThrow();
  });

  it('strict mode rejects extra fields on objects reached via .optional()', () => {
    const schema = EnvelopeSchema(
      z.object({ nested: z.object({ id: z.string() }).optional() })
    );
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { nested: { id: 'x', leak: true } } } as any, { strict: true })
    ).toThrow();
  });

  it('strict mode rejects extra fields on objects reached via .nullable()', () => {
    const schema = EnvelopeSchema(
      z.object({ nested: z.object({ id: z.string() }).nullable() })
    );
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { nested: { id: 'x', leak: true } } } as any, { strict: true })
    ).toThrow();
  });

  it('strict mode preserves ISODateTime refine (ZodEffects leaf is returned as-is)', () => {
    // ISODateTime = z.string().refine(...). This is a ZodEffects, not an object,
    // so strict mode should not affect it — it just must keep working.
    const ISODateTime = z.string().refine(
      (s) => !Number.isNaN(new Date(s).getTime()),
      { message: 'must be ISO 8601 datetime' }
    );
    const schema = EnvelopeSchema(z.object({ created_at: ISODateTime }));
    const res = { json: vi.fn() } as any;
    expect(() =>
      respond(res, schema, { ok: true, data: { created_at: 'not-a-date' } } as any, { strict: true })
    ).toThrow();
  });
});