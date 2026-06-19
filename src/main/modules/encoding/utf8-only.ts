import type { Request, Response, NextFunction, RequestHandler } from 'express';

const SKIP_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

/** Hard cap matches `express.json({ limit: '4kb' })`. Bodies above are rejected. */
const MAX_BODY_BYTES = 4 * 1024;

/**
 * Reject POST/PUT/PATCH requests that:
 *
 * 1. Have a non-JSON Content-Type, OR
 * 2. Declare a charset other than UTF-8 (e.g. `application/json; charset=gbk`), OR
 * 3. Contain body bytes that are NOT valid UTF-8 (e.g. a body serialized
 *    as GBK / GB18030 — common on Windows clients where the terminal
 *    codepage is GBK).
 *
 * Why this matters: Express's `json()` parser uses `TextDecoder('utf-8')`
 * which silently replaces invalid bytes with U+FFFD (the � replacement
 * character). When that body is later persisted (candidate titles,
 * company names, etc.), the data is stored as mojibake and downstream
 * consumers can't recover it.
 *
 * Behavior:
 * - Validates the **raw bytes**, not just the Content-Type header
 *   (clients can lie about the header; Windows GBK clients typically
 *   claim `application/json` without a charset and still send GBK).
 * - On invalid bytes: 400 INVALID_CHARSET with an actionable hint
 *   pointing to `ensure_ascii=False` (Python) or `Buffer.from(str, 'utf8')`
 *   (Node).
 * - On success: parses the JSON body itself and sets `req.body`, so the
 *   downstream `express.json()` short-circuits and won't re-decode the
 *   (already-validated) bytes.
 */
export function createUtf8OnlyMiddleware(): RequestHandler {
  // `fatal: true` makes decode() throw RangeError on invalid UTF-8
  // instead of silently substituting U+FFFD.
  const decoder = new TextDecoder('utf-8', { fatal: true });

  return function utf8Only(req: Request, res: Response, next: NextFunction): void {
    if (SKIP_METHODS.has(req.method.toUpperCase())) return next();

    // --- 1. Content-Type gate ---
    const ct = (req.headers['content-type'] || '').trim();
    if (ct && !/^application\/json/i.test(ct)) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Content-Type must be application/json (defaults to UTF-8 per RFC 8259) or application/json; charset=utf-8',
        },
      });
      return;
    }
    const charsetMatch = ct.match(/charset\s*=\s*([^;\s]+)/i);
    if (charsetMatch && !/^utf-?8$/i.test((charsetMatch[1] ?? '').trim())) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_CHARSET',
          message: `Charset ${charsetMatch[1]} is not supported. Use charset=utf-8 (or omit charset, which defaults to UTF-8 per RFC 8259).`,
        },
      });
      return;
    }

    // --- 2. Buffer raw bytes for validation ---
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        res.status(413).json({
          ok: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds ${MAX_BODY_BYTES} bytes` },
        });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted || res.headersSent) return;
      const raw = Buffer.concat(chunks);

      // 2a. Strict UTF-8 validation
      let text: string;
      try {
        text = decoder.decode(raw); // throws RangeError on invalid UTF-8
      } catch {
        const looksLikeGbk = detectGbk(raw);
        res.status(400).json({
          ok: false,
          error: {
            code: 'INVALID_CHARSET',
            message: looksLikeGbk
              ? 'Request body is not valid UTF-8 (looks like GBK/GB18030 bytes). Re-serialize the JSON body as UTF-8 and resend.'
              : 'Request body is not valid UTF-8. Re-serialize the JSON body as UTF-8 and resend.',
            details: {
              byte_length: raw.length,
              ...(looksLikeGbk && { suspected_charset: 'GBK/GB18030' }),
              hint: 'Python: json.dumps(data, ensure_ascii=False).encode("utf-8"). Node: Buffer.from(JSON.stringify(data), "utf8"). curl: --data-binary @file.json (file must be UTF-8).',
            },
          },
        });
        return;
      }

      // 2b. Parse JSON ourselves (so downstream express.json() short-circuits)
      if (raw.length === 0) {
        // Empty body — mark as parsed so express.json() skips
        (req as unknown as { _body?: boolean })._body = true;
        next();
        return;
      }
      try {
        req.body = JSON.parse(text);
      } catch (e) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'INVALID_JSON',
            message: 'Request body is not valid JSON',
            details: { parse_error: (e as Error).message },
          },
        });
        return;
      }
      // Tell body-parser we've already consumed & parsed the body;
      // otherwise it will throw "stream is not readable" because we
      // drained the request stream above.
      (req as unknown as { _body?: boolean })._body = true;
      next();
    });

    req.on('error', (err) => {
      if (!res.headersSent) next(err);
    });
  };
}

/**
 * Heuristic: does `raw` look like GBK/GB18030 rather than UTF-8?
 *
 * GBK lead-byte range: 0x81-0xFE. Trail-byte ranges: 0x40-0x7E, 0x80-0xFE.
 * UTF-8 continuation bytes (after the lead): 0x80-0xBF only.
 *
 * If we see a high byte (>=0x80) followed by another byte in 0x40-0x7F
 * (printable ASCII range that GBK accepts as a trail byte but UTF-8
 * never does), it's almost certainly GBK.
 *
 * This is a best-effort signal for the error message — the real
 * validation is the strict TextDecoder above.
 */
function detectGbk(raw: Buffer): boolean {
  for (let i = 0; i < raw.length - 1; i++) {
    const b0 = raw[i]!;
    const b1 = raw[i + 1]!;
    if (b0 >= 0x81 && b0 <= 0xfe && b1 >= 0x40 && b1 <= 0x7e) {
      return true;
    }
  }
  return false;
}