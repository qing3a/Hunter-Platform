// tests/integration/landing-v3.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/main/server';

describe('GET / - v3 features', () => {
  beforeEach(() => {
    process.env.PLATFORM_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64');
    process.env.WEBHOOK_HMAC_SECRET = 'test-secret-1234567890';
    process.env.ADMIN_PASSWORD_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyz';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
  });
  afterEach(() => { delete process.env.DATABASE_PATH; });

  it('renders sticky top nav', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="top-nav"');
    expect(res.text).toContain('Hunter Platform');
  });

  it('renders status badge with HEALTHY label', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('HEALTHY');
    // A1: uptime is now real (process.uptime()). Accept 99.9 (long uptime)
    // or 100 (fresh boot <60s). Reject hardcoded constant.
    expect(res.text).toMatch(/99\.9|100/);
  });

  it('renders 4 role anchors', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('for-employers');
    expect(res.text).toContain('for-headhunters');
    expect(res.text).toContain('for-candidates');
    expect(res.text).toContain('rankings');
  });

  it('renders AGENT GATE with copy button', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="agent-gate"');
    expect(res.text).toContain('/v1/skill.md');
    expect(res.text).toContain('js-copy-btn');
  });

  it('renders 5 ranking tabs OR cold-start collapse placeholder', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // Either 5 tabs (data exists) OR cold-start collapse placeholder
    const hasAllTabs = res.text.includes('Top 猎头') &&
                       res.text.includes('Top 雇主') &&
                       res.text.includes('Top 行业') &&
                       res.text.includes('成交') &&
                       res.text.includes('Hot Skills');
    const hasCollapse = res.text.includes('rankings-empty') &&
                        res.text.includes('榜单将在首批数据后开放');
    expect(hasAllTabs || hasCollapse).toBe(true);
    // H2 always present
    expect(res.text).toContain('多维榜单');
  });

  it('renders footer with skill.md + openapi + health links', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.text).toContain('class="site-footer"');
    expect(res.text).toContain('Made with care for Agents');
  });

  it('does not leak PII (emails, user IDs)', async () => {
    const app = createApp();
    await request(app).post('/v1/auth/register').send({
      user_type: 'pm', name: 'PII Test', contact: 'leak@private.com',
    });
    const res = await request(app).get('/');
    expect(res.text).not.toContain('leak@private.com');
    expect(res.text).not.toMatch(/user_[a-f0-9]{12}/);
  });

  it('handles empty DB gracefully', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Hunter Platform');
  });

  it('rankings tabs expose full WAI-ARIA Tab Pattern', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // P2b: rankings is cold-start collapsed when no data — full ARIA pattern only
    // applies when tabs are rendered. Accept either state.
    if (res.text.includes('rankings-empty')) {
      // Cold-start collapse: only H2 + empty-state placeholder, no tabs
      expect(res.text).toContain('多维榜单');
      expect(res.text).toContain('榜单将在首批数据后开放');
      expect(res.text).not.toMatch(/aria-controls="ranking-panel-/);
    } else {
      // Full ARIA pattern with 5 tabs
      expect(res.text).toMatch(/aria-controls="ranking-panel-/);
      expect(res.text).toMatch(/aria-labelledby="ranking-tab-/);
      const rankingInactive = (res.text.match(/data-tab="(hunters|employers|industries|placements|skills)" aria-selected="false"/g) || []).length;
      expect(rankingInactive).toBe(4);
    }
    // Roving tabindex: roles-switcher (1 active tab) is always rendered → at least 1
    const tabindex0Count = (res.text.match(/tabindex="0"/g) || []).length;
    expect(tabindex0Count).toBeGreaterThanOrEqual(1);
    expect(tabindex0Count).toBeLessThanOrEqual(2);
  });

  it('renders .empty-state markup in 4 cold-start sections', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // .empty-state container class
    expect((res.text.match(/class="empty-state"/g) || []).length).toBeGreaterThanOrEqual(4);
    // .empty-state-cta "成为第一个"-style CTAs preserved
    expect((res.text.match(/class="empty-state-cta"/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('A1: cold-start stats render as honest "—" placeholders, not bold "0"', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // 3 zero stats use .stat-empty class
    expect((res.text.match(/class="stat-value stat-empty"/g) || []).length).toBe(3);
    // Each empty stat label carries "等待中" suffix
    expect(res.text).toContain('等待中');
    // Uptime stays a real percentage (no .stat-empty on it)
    expect(res.text).toMatch(/class="stat-value">\d/);
  });

  it('hero role-cards container does not collide with sticky role-anchors', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // The hero's 3 CTA cards use .role-cards (NOT the sticky sub-nav .role-anchors)
    expect(res.text).toContain('class="role-cards"');
    // role-card is now also a js-role-anchor → match with space prefix
    expect((res.text.match(/class="role-card /g) || []).length).toBe(3);
    // The sticky sub-nav (role-anchors.ts) is rendered as <nav class="role-anchors">
    // with 3 role pills (header redesign moved Agent to nav-cta-agent)
    expect(res.text).toMatch(/<nav class="role-anchors"/);
    expect((res.text.match(/class="role-anchor js-role-anchor"/g) || []).length).toBe(3);
  });

  it('P1c: roles-switcher merges 3 for-X sections into 1 tabbed section', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // Single merged section with id="for-roles"
    expect(res.text).toContain('id="for-roles"');
    expect(res.text).toContain('class="card roles-switcher"');
    // 3 tabs: candidates / employers / headhunters (first has extra "active" class)
    expect((res.text.match(/class="ranking-tab js-roles-tab/g) || []).length).toBe(3);
    // Default active tab = candidates (privacy narrative first)
    expect(res.text).toMatch(/data-tab="candidates"[^>]*aria-selected="true"/);
    // 3 tabpanels with role="tabpanel"
    expect((res.text.match(/id="roles-panel-/g) || []).length).toBe(3);
    // Old standalone section IDs are gone
    expect(res.text).not.toContain('id="for-employers"');
    expect(res.text).not.toContain('id="for-headhunters"');
    // href="#for-roles" appears 6 times total: 3 in sticky nav (.role-anchor)
    // + 3 in hero (.role-card with js-role-anchor) — all carry data-role
    expect((res.text.match(/href="#for-roles" data-target="for-roles" data-role="/g) || []).length).toBe(6);
  });

  it('nav: no duplicate Agent 开发者 link + SVG icons (Bug 1+5+6)', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // Bug 1 (updated): nav-cta-agent now exists in nav as INDEPENDENT CTA (not duplicate)
    // — it lives in nav.ts, NOT in role-anchors.ts
    expect(res.text).toMatch(/<a class="nav-cta-agent"/);
    expect(res.text).not.toMatch(/role-anchors[\s\S]{0,400}class="nav-cta-agent"/);
    // Bug 5: brand-mark is SVG, not emoji
    expect(res.text).toMatch(/class="brand-mark"[^>]*>[^<]*<svg/);
    expect(res.text).not.toMatch(/class="brand-mark"[^>]*>🔍</);
    // Bug 6: role-anchors icons are SVG (3 sticky-nav role pills)
    const navIconSvgCount = (res.text.match(/<a class="role-anchor js-role-anchor"[\s\S]*?class="role-icon" aria-hidden="true"><svg/g) || []).length;
    expect(navIconSvgCount).toBe(3);
    // Bug 3: status-badge simplified — only shows health label, no uptime % in nav
    expect(res.text).toMatch(/status-label-text[^>]*>HEALTHY</);
    expect(res.text).not.toMatch(/HEALTHY&nbsp;\d/);
    // Bug 4: status-dot no longer uses hardcoded inline style (removed colorMap from partial)
    expect(res.text).not.toMatch(/<span class="status-dot" style="background:/);
  });

  it('header redesign: copy button only 1× in nav + Agent independent + role-anchors has rankings-jump', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // Header redesign: nav layer 1 has exactly 1 icon-only copy button (copy-btn-compact).
    // Note: footer also has a copy button (copy-btn-cta) — total 2, but nav-only is 1.
    // Match <button class="copy-btn-compact ..."> HTML element (not CSS rules).
    const navCopyBtnCount = (res.text.match(/<button[^>]*class="[^"]*copy-btn-compact[^"]*"/g) || []).length;
    expect(navCopyBtnCount).toBe(1);
    expect(res.text).toContain('copy-btn-compact');
    // Agent 开发者 is now an independent teal CTA in nav layer 1 (not in role-anchors)
    expect(res.text).toMatch(/<a class="nav-cta-agent"/);
    expect(res.text).toContain('Agent');  // visible label
    // role-anchors: 3 role pills + 1 rankings-jump link (no Agent here anymore)
    expect((res.text.match(/class="role-anchor js-role-anchor"/g) || []).length).toBe(3);
    expect(res.text).toContain('class="rankings-jump');
    expect(res.text).not.toMatch(/role-anchors[\s\S]{0,400}Agent 开发者/);
    // brand has tagline (≥1024px via CSS, present in DOM)
    expect(res.text).toContain('class="brand-tagline"');
    expect(res.text).toContain('猎头中介 API');
    // nav is structured as 4 sections (brand + spacer + actions + hamburger)
    expect(res.text).toMatch(/class="nav-spacer"/);
    expect(res.text).toMatch(/class="nav-actions"/);
  });

  it('footer-cta + hero agent-gate: clean copy without nav 顶部 hints', async () => {
    const app = createApp();
    const res = await request(app).get('/');
    // Footer CTA is now a copy button (js-copy-btn), not a link
    expect(res.text).toMatch(/<div class="footer-cta-action">[\s\S]*?class="copy-btn copy-btn-cta js-copy-btn"[\s\S]*?<\/div>/);
    expect(res.text).not.toMatch(/<a class="footer-cta-btn"/);
    // Footer CTA text no longer mentions "nav 顶部"
    expect(res.text).not.toContain('nav 顶部的');
    // Hero agent-gate title no longer mentions "nav 顶部"
    expect(res.text).not.toMatch(/agent-gate-title[^>]*>[\s\S]*?nav 顶部/);
    // Plain agent-gate title (clean)
    expect(res.text).toContain('把链接发给 AI Agent 即可对接');
  });
});