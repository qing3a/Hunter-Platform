// src/main/modules/view/templates/landing/layout.ts
import { html } from '../lib/html.js';
import { SHARED_CSS } from '../shared-css.js';
import { LANDING_CSS } from './landing.css.js';
import { LANDING_SCRIPT } from './landing.script.js';

export function layout(body: string): string {
  return html`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hunter Platform · 猎头中介 API 平台</title>
  <style>${SHARED_CSS}</style>
  <style>${LANDING_CSS}</style>
</head>
<body>
  ${body}
  ${LANDING_SCRIPT}
</body>
</html>
  `;
}