import type { Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

/**
 * Recursively clone a zod schema and apply `.strict()` to all ZodObject
 * nodes so that unknown keys cause a parse failure (instead of being
 * silently stripped).
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
  return schema;
}

/**
 * Standard API response envelope: either { ok: true, data: T } or
 * { ok: false, error: { code, message, details? } }. Error responses are
 * built by errors.ts middleware and intentionally NOT wrapped here.
 *
 * Helper, not a wrapper: we want every route to declare its data schema
 * explicitly. The route passes the full envelope schema to `respond()`.
 */
export function EnvelopeSchema<T extends ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
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