import type { Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { EnvelopeSchema } from './schemas/common.js';
import { getTraceIdFromContext } from './telemetry.js';

// Re-export so existing imports of `respond, EnvelopeSchema` from
// '../responses.js' keep working. New code should import `EnvelopeSchema`
// from './schemas/common.js' to avoid coupling.
export { EnvelopeSchema };

/**
 * Recursively clone a zod schema and apply `.strict()` to all ZodObject
 * nodes so that unknown keys cause a parse failure (instead of being
 * silently stripped). Recurses into:
 *  - ZodObject:           apply .strict() to the cloned object
 *  - ZodArray:            recurse into the element type
 *  - ZodUnion:            recurse into each option
 *  - ZodDiscriminatedUnion: recurse into each option
 *  - ZodOptional / ZodNullable: recurse into the unwrapped inner type
 *  - ZodEffects (e.g. .refine()): returned as-is — no key concept
 *  - ZodString / ZodNumber / ZodLiteral / ZodEnum / ZodDate: returned as-is
 *
 * Without recursing into Optional/Nullable, a field like
 *   { foo: z.string().optional() }
 * gets a stale .optional() wrapping a fresh string type — which still
 * works in practice but means the resulting schema's type identity drifts
 * from the input. The recursion normalizes everything below the object.
 */
function makeStrict<T extends ZodTypeAny>(schema: T): T {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const newShape: Record<string, ZodTypeAny> = {};
    for (const [key, value] of Object.entries(shape)) {
      newShape[key] = makeStrict(value);
    }
    return z.object(newShape as any).strict() as unknown as T;
  }
  if (schema instanceof z.ZodArray) {
    return z.array(makeStrict(schema.element)) as unknown as T;
  }
  if (schema instanceof z.ZodUnion) {
    // z.union() expects a tuple type [ZodTypeAny, ZodTypeAny, ...], not ZodTypeAny[],
    // so we cast through unknown. The runtime check is exactly the same.
    const opts = (schema as unknown as { options: ZodTypeAny[] }).options.map((opt) => makeStrict(opt));
    return (z.union as unknown as (o: ZodTypeAny[]) => ZodTypeAny)(opts) as T;
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const opts = (schema as unknown as { options: Record<string, ZodTypeAny> }).options;
    const newOpts: Record<string, ZodTypeAny> = {};
    for (const [key, value] of Object.entries(opts)) {
      newOpts[key] = makeStrict(value);
    }
    return z.discriminatedUnion(
      (schema as unknown as { discriminator: string }).discriminator,
      newOpts as any,
    ) as unknown as T;
  }
  if (schema instanceof z.ZodOptional) {
    return z.optional(makeStrict((schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType)) as unknown as T;
  }
  if (schema instanceof z.ZodNullable) {
    return z.nullable(makeStrict((schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType)) as unknown as T;
  }
  // ZodEffects, ZodString, ZodNumber, ZodLiteral, ZodEnum, ZodDate, etc. — no key concept, return as-is.
  return schema;
}

/**
 * Error envelope schema — used by routes that return inline errors
 * (rare; most errors flow through errors.ts → error middleware).
 */
export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export interface RespondOptions {
  /** When true, payload is rejected if it contains fields not in the schema.
   *  Default false (extra fields are stripped, matching existing lenient
   *  behavior — internal callers may add fields for forward-compat). */
  strict?: boolean;
}

/**
 * Validate `payload` against `schema`, then send via `res.json()`.
 *
 * Two failure modes, both THROW (no silent fallback — silent data loss is
 * worse than a 500 in this codebase):
 *
 *   1. strict=true:   unknown keys fail the parse → throw ZodError
 *   2. strict=false:  known shape mismatch (wrong type / missing required
 *                     field) fails the parse → throw ZodError. (Unknown
 *                     keys are silently stripped in this mode, by design.)
 *
 * Throws ZodError in both cases. The error middleware in server.ts
 * converts ZodError into 500 INTERNAL_ERROR with details — log + alert.
 *
 * Why no fallback to permissive send: a schema mismatch indicates a
 * handler-vs-schema drift, which is a developer error that should be
 * loud, not papered over. The Phase 1 plan called for a console.warn
 * fallback here, but on review (491e8c8 MEDIUM M4) the maintainer
 * decided throwing is the safer default — silent fallback would let
 * a buggy handler ship to production undetected.
 */
export function respond<T extends ZodTypeAny>(
  res: Response,
  schema: T,
  payload: unknown,
  opts: RespondOptions = {},
): void {
  const effectiveSchema = opts.strict ? makeStrict(schema) : schema;
  const result = effectiveSchema.safeParse(payload);

  if (!result.success) {
    throw result.error;
  }

  // Stamp the response with the active OTel trace_id so external Agents
  // can report a failure with this id and we can correlate to
  // action_history.trace_id + OTel spans.
  const traceId = getTraceIdFromContext();
  if (traceId) res.setHeader('x-trace-id', traceId);

  res.json(result.data);
}