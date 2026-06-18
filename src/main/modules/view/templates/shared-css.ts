export const SHARED_CSS = `
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  margin: 0; padding: 24px;
  background: #f5f7fa; color: #2c3e50;
  line-height: 1.6;
}
main { max-width: 720px; margin: 0 auto; background: white; padding: 32px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
h1 { margin-top: 0; font-size: 24px; color: #1a202c; }
h2 { font-size: 18px; color: #2c3e50; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
.card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 12px 0; }
.tag { display: inline-block; background: #edf2f7; border-radius: 4px; padding: 4px 10px; margin: 2px; font-size: 13px; color: #4a5568; }
.tag.skill { background: #ebf8ff; color: #2c5282; }
.tag.industry { background: #f0fff4; color: #22543d; }
.timeline { position: relative; padding-left: 24px; }
.timeline::before { content: ''; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: #cbd5e0; }
.timeline-item { position: relative; margin-bottom: 16px; }
.timeline-item::before { content: ''; position: absolute; left: -22px; top: 6px; width: 12px; height: 12px; border-radius: 50%; background: #4299e1; border: 2px solid white; box-shadow: 0 0 0 1px #cbd5e0; }
.timeline-item.done::before { background: #48bb78; }
.timeline-item.current::before { background: #ed8936; box-shadow: 0 0 0 2px #ed8936, 0 0 0 4px white; }
.meta { color: #718096; font-size: 13px; }
.error { text-align: center; padding: 48px 24px; }
.error h1 { color: #c53030; }
.error .hint { color: #718096; font-size: 14px; margin-top: 24px; }
.kv { display: grid; grid-template-columns: 160px 1fr; gap: 8px 16px; margin: 12px 0; }
.kv dt { color: #718096; font-size: 13px; }
.kv dd { margin: 0; font-weight: 500; }
`.trim();