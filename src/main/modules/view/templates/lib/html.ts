// src/main/modules/view/templates/lib/html.ts

export function esc(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]!));
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
        // Already-rendered HTML strings (from other html`` calls) pass through
        out += (v as { toString(): string }).toString();
      } else {
        out += esc(v);
      }
    }
  }
  return out;
}