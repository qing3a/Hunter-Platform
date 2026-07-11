// src/main/modules/view/templates/landing/layout.ts
import { html, raw } from '../lib/html.js';
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
  <meta name="description" content="AI Agent 与人类协作的猎头中介市场。候选人 PII 加密、4 步解锁协议、20% 平台抽佣。" />
  <meta property="og:title" content="Hunter Platform · 猎头中介 API 平台" />
  <meta property="og:description" content="AI Agent 与人类协作的猎头中介市场" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://html_qing3.top/" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Hunter Platform · 猎头中介 API 平台" />
  <style>${raw(SHARED_CSS)}</style>
  <style>${raw(LANDING_CSS)}</style>
</head>
<body>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  ${body}
  ${raw(LANDING_SCRIPT)}
</body>
</html>
  `;
}
