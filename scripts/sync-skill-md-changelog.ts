#!/usr/bin/env -S node --import tsx
/**
 * sync-skill-md-changelog.ts
 *
 * Pulls the top "## [Unreleased]" block out of CHANGELOG.md and injects
 * it into the "## 📝 最近升级" section of docs/superpowers/skill.md,
 * replacing whatever sits between two HTML-comment markers there.
 *
 * Idempotent: re-running on an already-synced skill.md produces no diff.
 *
 * Usage:
 *   pnpm skill:changelog
 *   tsx scripts/sync-skill-md-changelog.ts
 *
 * Exit codes:
 *   0  — applied or no-op (in-sync)
 *   1  — invalid invocation / IO error
 *   2  — markers or Unreleased block missing (refuse to silently corrupt)
 *
 * Skill.md MUST contain this exact comment pair:
 *
 *   <!-- CHANGELOG_INJECT_START -->
 *   ...
 *   <!-- CHANGELOG_INJECT_END -->
 *
 * If either marker is absent, the script fails fast. To enable sync for
 * the first time, add the markers around your "recent changes" content
 * area (typically right under "## 📝 最近升级").
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const SKILL_MD_PATH  = path.join(ROOT, 'docs', 'superpowers', 'skill.md');

const INJ_START = '<!-- CHANGELOG_INJECT_START -->';
const INJ_END   = '<!-- CHANGELOG_INJECT_END -->';

function readOrDie(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch (err) {
    console.error(`Cannot read ${p}: ${(err as Error).message}`);
    process.exit(1);
  }
}

const chg = readOrDie(CHANGELOG_PATH);
const skill = readOrDie(SKILL_MD_PATH);

// Locate Unreleased block in CHANGELOG.md
const blockStart = chg.indexOf('## [Unreleased]');
if (blockStart < 0) {
  console.error(`CHANGELOG.md has no '## [Unreleased]' section (CHANGELOG_PATH=${CHANGELOG_PATH}).`);
  process.exit(2);
}
const blockEnd = chg.indexOf('\n---\n', blockStart);
if (blockEnd < 0) {
  console.error(`Unreleased block in CHANGELOG.md has no trailing '---' delimiter.`);
  process.exit(2);
}
const block = chg.slice(blockStart, blockEnd).trim();

// Locate markers in skill.md
const injStartIdx = skill.indexOf(INJ_START);
const injEndIdx   = skill.indexOf(INJ_END);
if (injStartIdx < 0 || injEndIdx < 0) {
  console.error(`skill.md missing ${INJ_START} / ${INJ_END} markers.`);
  console.error(`Add them around the "recent changes" block under "## 📝 最近升级", then re-run.`);
  process.exit(2);
}
if (injEndIdx < injStartIdx) {
  console.error(`skill.md markers are out of order (END before START).`);
  process.exit(2);
}

const head = skill.slice(0, injStartIdx + INJ_START.length);
const tail = skill.slice(injEndIdx);
const newSection = `${head}\n\n${block}\n\n${tail}`;

if (newSection === skill) {
  console.log('skill.md already in sync (no changes).');
  process.exit(0);
}

writeFileSync(SKILL_MD_PATH, newSection, 'utf8');
console.log(`✓ Injected ${block.length} bytes of CHANGELOG [Unreleased] into skill.md`);
console.log(`  source: ${CHANGELOG_PATH}`);
console.log(`  target: ${SKILL_MD_PATH}`);
