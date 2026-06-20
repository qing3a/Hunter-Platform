// src/main/modules/view/templates/lib/html.ts

export function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
}

/**
 * Mark a string as trusted raw HTML so html`` won't escape it.
 * Useful when you need to interpolate a pre-rendered string but want to be
 * explicit about it. By default, string values are also passed through.
 */
export function raw(s: string): { toString(): string } {
  return { toString: () => s };
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) continue;
      if (Array.isArray(v)) {
        for (const item of v) out += (item == null || item === false) ? '' : esc(item);
      } else if (typeof v === 'object' && v && 'toString' in v && typeof (v as { toString(): string }).toString === 'function') {
        // Already-rendered HTML strings (from other html`` calls or raw()) pass through
        out += (v as { toString(): string }).toString();
      } else if (typeof v === 'string') {
        // String values are treated as already-rendered HTML (from another html`` call).
        // This matches the standard tagged-template pattern (Lit, htm, etc.) and
        // avoids double-escaping when html templates are nested.
        out += v;
      } else {
        // Primitives (number, boolean) are coerced via esc for safety.
        out += esc(v);
      }
    }
  }
  return out;
}