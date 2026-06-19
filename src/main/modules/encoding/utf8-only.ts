import type { Request, Response, NextFunction, RequestHandler } from 'express';

const CHARSET_RE = /^application\/json(?:\s*;\s*charset\s*=\s*utf-?8)$/i;
const SKIP_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

/**
 * Reject POST/PUT/PATCH requests whose Content-Type is not
 * `application/json; charset=utf-8`. Prevents the server from silently
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
    if (!CHARSET_RE.test(ct)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_CHARSET',
          message: 'Content-Type must be application/json; charset=utf-8',
        },
      });
    }
    next();
  };
}