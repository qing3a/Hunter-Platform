import { SHARED_CSS } from './shared-css.js';

export interface ErrorPageOptions {
  httpStatus: number;
  title: string;
  message: string;
  icon: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderErrorPage(opts: ErrorPageOptions): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${esc(opts.title)} — Hunter Platform</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <main class="error">
    <h1>${esc(opts.icon)} ${esc(opts.title)}</h1>
    <p>${esc(opts.message)}</p>
    <p class="hint">如需帮助，请重新发起请求。</p>
  </main>
</body>
</html>`;
}