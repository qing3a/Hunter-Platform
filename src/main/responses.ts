import type { Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { EnvelopeSchema } from './schemas/common.js';

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
 * Strips unknown keys by default (z.safeParse → take only declared fields),
 * so handlers can't accidentally leak extra fields to API clients.
 *
 * Throws ZodError on schema mismatch. The error middleware in server.ts
 * converts ZodError into 500 INTERNAL_ERROR with details — log + alert.
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
    if (opts.strict) throw result.error;
    // safeParse failed but strict=false: fall back to permissive send with console.warn
    console.error('[respond] schema mismatch (stripping unknown fields failed too):', result.error.issues);
    throw result.error;
  }

  res.json(result.data);
}