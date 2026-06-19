import type { Request, Response, NextFunction, RequestHandler } from 'express';

const SKIP_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

/**
 * Validate that POST/PUT/PATCH requests use `application/json` with
 * either UTF-8 (explicit) or no charset (defaults to UTF-8 per RFC 8259).
 *
 * Returns true if the Content-Type is acceptable; false otherwise.
 * The actual charset validation:
 *   - `application/json`                  → OK (defaults to UTF-8)
 *   - `application/json; charset=utf-8`   → OK
 *   - `application/json; charset=utf8`    → OK
 *   - `application/json; charset=gbk`     → REJECT (would be mis-decoded)
 *   - `text/plain`, `application/xml`, …  → REJECT (not JSON)
 */
/**
 * Validate that POST/PUT/PATCH requests use `application/json` with
 * either UTF-8 (explicit) or no charset (defaults to UTF-8 per RFC 8259).
 *
 * Returns true if the Content-Type is acceptable; false otherwise.
 * The actual charset validation:
 *   - (no Content-Type header, e.g. POST with empty body)   → OK
 *   - `application/json`                                    → OK (defaults to UTF-8)
 *   - `application/json; charset=utf-8`                     → OK
 *   - `application/json; charset=utf8`                      → OK
 *   - `application/json; charset=gbk`                       → REJECT (would be mis-decoded)
 *   - `text/plain`, `application/xml`, …                    → REJECT (not JSON)
 */
function isAcceptableContentType(ct: string): boolean {
  if (!ct) return true;  // no Content-Type → no body to decode, accept
  if (!/^application\/json/i.test(ct)) return false;
  const charsetMatch = ct.match(/charset\s*=\s*([^;\s]+)/i);
  if (!charsetMatch) return true;  // no charset → defaults to UTF-8
  return /^utf-?8$/i.test((charsetMatch[1] ?? '').trim());
}

/**
 * Reject POST/PUT/PATCH requests whose Content-Type is not UTF-8
 * (or would not default to UTF-8). Prevents the server from silently
 * decoding mis-encoded bodies (e.g. GBK) as UTF-8, which produces
 * garbled Chinese text in stored data.
 *
 * Mount BEFORE `express.json()` so the body is never parsed under
 * the wrong charset.
 */
export function createUtf8OnlyMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SKIP_METHODS.has(req.method.toUpperCase())) return next();

    const ct = (req.headers['content-type'] || '').trim();
    if (!isAcceptableContentType(ct)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_CHARSET',
          message: 'Content-Type must be application/json (defaults to UTF-8 per RFC 8259) or application/json; charset=utf-8',
        },
      });
    }
    next();
  };
}