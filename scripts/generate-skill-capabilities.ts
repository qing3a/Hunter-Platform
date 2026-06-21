/**
 * pnpm capabilities:doc — regenerate the "## 角色能力清单" section of
 * docs/superpowers/skill.md from the capability declarations in
 * src/main/capabilities/*.ts.
 *
 * The section is delimited by HTML-style comments:
 *   <!-- CAPABILITIES_START -->
 *   ... generated content ...
 *   <!-- CAPABILITIES_END -->
 *
 * Anything outside these markers is preserved untouched. Running the script
 * twice should be a no-op (idempotent).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  headhunterCapabilities, employerCapabilities, candidateCapabilities,
  adminCapabilities, authCapabilities,
} from '../src/main/capabilities/index.js';
import type { CapabilitySet } from '../src/main/capabilities/types.js';

const SKILL_PATH = path.join(__dirname, '../docs/superpowers/skill.md');
const START_MARKER = '<!-- CAPABILITIES_START -->';
const END_MARKER = '<!-- CAPABILITIES_END -->';

// Render order: auth first, then roles in user-facing order.
const SETS: CapabilitySet[] = [
  authCapabilities, headhunterCapabilities, employerCapabilities, candidateCapabilities, adminCapabilities,
];

const ROLE_LABELS: Record<string, string> = {
  auth:       '认证 (auth)',
  headhunter: '猎头 (headhunter)',
  employer:   '雇主 (employer)',
  candidate:  '候选人 (candidate)',
  admin:      '管理员 (admin)',
};

function render(): string {
  const lines: string[] = [];
  lines.push('## 🎯 角色能力清单（自动生成 — 不要手改）');
  lines.push('');
  lines.push('> 这一节由 `pnpm capabilities:doc` 从 `src/main/capabilities/*.ts` 自动生成。');
  lines.push('> 修改流程: 编辑 capability 文件 → 跑 `pnpm capabilities:doc` → commit。');
  lines.push('');
  for (const set of SETS) {
    const title = ROLE_LABELS[set.role] ?? set.role;
    lines.push(`### ${title} — ${set.capabilities.length} 个能力`);
    lines.push('');
    lines.push('| Method | Path | 能力名 | 配额 | 前置条件 | 副作用 |');
    lines.push('|--------|------|--------|------|----------|--------|');
    for (const c of set.capabilities) {
      const pre = c.preconditions.length ? c.preconditions.join('; ') : '—';
      const eff = c.effects.length ? c.effects.slice(0, 2).join('; ') + (c.effects.length > 2 ? '…' : '') : '—';
      lines.push(`| ${c.method} | \`${c.path}\` | \`${c.name}\` | ${c.quota_cost} | ${pre} | ${eff} |`);
    }
    lines.push('');
    lines.push('> ' + set.capabilities.map((c) => `- \`${c.name}\`: ${c.description}`).join('\n> '));
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  const skill = fs.readFileSync(SKILL_PATH, 'utf8');
  const startIdx = skill.indexOf(START_MARKER);
  const endIdx = skill.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) {
    console.error(`ERROR: skill.md must contain both ${START_MARKER} and ${END_MARKER} markers.`);
    process.exit(1);
  }
  if (endIdx < startIdx) {
    console.error(`ERROR: ${END_MARKER} appears before ${START_MARKER}.`);
    process.exit(1);
  }

  const before = skill.slice(0, startIdx + START_MARKER.length);
  const after = skill.slice(endIdx);
  const generated = render();
  const newSkill = before + '\n' + generated + '\n' + after;

  if (newSkill === skill) {
    console.log('OK: skill.md capability section already up-to-date (no diff).');
    return;
  }
  fs.writeFileSync(SKILL_PATH, newSkill, 'utf8');
  const totalCaps = SETS.reduce((n, s) => n + s.capabilities.length, 0);
  console.log(`OK: skill.md updated with ${totalCaps} capabilities across ${SETS.length} roles.`);
}

main();