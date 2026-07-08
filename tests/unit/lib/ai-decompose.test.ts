// tests/unit/lib/ai-decompose.test.ts
//
// PM Workbench (Phase 3b, Task 6) — Unit tests for the `decomposePositions`
// heuristic library (src/main/lib/ai-decompose.ts).
//
// What this covers (per plan "Self-Review"):
//   - All keyword templates match correctly (vue, react, node, java, ios,
//     android, devops, k8s, docker, qa, test, product, pm, design, ui,
//     algorithm, ai, ml, data)
//   - Default fallback (全栈工程师) when no keyword matches
//   - Every suggested position has a non-empty `rationale` field
//     ("AI 启发式必须有理由,不能黑盒")
//   - Duplicates are de-duplicated by `title` (the same template should
//     never produce the same title twice)
//   - Multi-keyword rationale lists all matched keywords
//   - The 800ms simulated AI delay actually elapses
//
// Pattern matches tests/unit/lib/matching.test.ts: pure-function unit tests
// with no DB / no Express. Vitest fakeTimers drives the 800ms delay test so
// we don't actually wait a second.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decomposePositions,
  type DecomposedPosition,
} from '../../../src/main/lib/ai-decompose.js';

describe('lib: ai-decompose (decomposePositions)', () => {
  // Track fake-timer usage so the "800ms delay" test can fast-forward without
  // actually sleeping. We install fresh timers around that test only — the
  // other tests don't depend on the delay.
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('keyword template matching', () => {
    it('matches frontend keywords (vue, react, frontend, 前端)', async () => {
      const result = await decomposePositions('我们需要一个 Vue 前端工程师');
      expect(result.length).toBeGreaterThan(0);
      const frontend = result.find((p) => p.title === '高级前端工程师');
      expect(frontend).toBeDefined();
      expect(frontend?.skills).toContain('vue');
      expect(frontend?.title_level).toBe('senior');
      // rationale must mention every matched keyword (vue + 前端)
      expect(frontend?.rationale).toContain('vue');
      expect(frontend?.rationale).toContain('前端');
    });

    it('matches react keyword alone (English)', async () => {
      const result = await decomposePositions('Looking for a React engineer');
      const frontend = result.find((p) => p.title === '高级前端工程师');
      expect(frontend).toBeDefined();
      expect(frontend?.rationale.toLowerCase()).toContain('react');
    });

    it('matches backend keywords (node, java, 后端, backend)', async () => {
      const result = await decomposePositions('We need a Node.js backend engineer');
      const backend = result.find((p) => p.title === '后端工程师');
      expect(backend).toBeDefined();
      expect(backend?.title_level).toBe('senior');
      expect(backend?.skills).toContain('node.js');
    });

    it('matches ios / swift keywords', async () => {
      const result = await decomposePositions('Hiring iOS Swift developer');
      const ios = result.find((p) => p.title === 'iOS 工程师');
      expect(ios).toBeDefined();
      expect(ios?.title_level).toBe('mid');
      expect(ios?.skills).toContain('swift');
    });

    it('matches android keyword', async () => {
      const result = await decomposePositions('需要一个 Android 工程师');
      const android = result.find((p) => p.title === 'Android 工程师');
      expect(android).toBeDefined();
      expect(android?.title_level).toBe('mid');
    });

    it('matches devops keywords (devops, k8s, docker)', async () => {
      const result = await decomposePositions('Build devops team with k8s + docker');
      const devops = result.find((p) => p.title === 'DevOps 工程师');
      expect(devops).toBeDefined();
      expect(devops?.skills).toContain('kubernetes');
      expect(devops?.skills).toContain('docker');
      expect(devops?.title_level).toBe('senior');
    });

    it('matches qa / 测试 / test keywords', async () => {
      const result = await decomposePositions('需要一个 测试工程师');
      const qa = result.find((p) => p.title === '测试工程师');
      expect(qa).toBeDefined();
      expect(qa?.title_level).toBe('mid');
    });

    it('matches pm / product / 产品 keywords', async () => {
      const result = await decomposePositions('招募 产品经理');
      const pm = result.find((p) => p.title === '产品经理');
      expect(pm).toBeDefined();
      expect(pm?.title_level).toBe('mid');
    });

    it('matches design / ui keywords', async () => {
      const result = await decomposePositions('Hire a UI 设计师');
      const designer = result.find((p) => p.title === 'UI 设计师');
      expect(designer).toBeDefined();
      expect(designer?.skills).toContain('figma');
    });

    it('matches ai / ml / 算法 / machine learning keywords', async () => {
      const result = await decomposePositions('需要一个 算法工程师，熟悉 machine learning');
      const algo = result.find((p) => p.title === '算法工程师');
      expect(algo).toBeDefined();
      expect(algo?.skills).toContain('python');
      expect(algo?.title_level).toBe('senior');
    });

    it('matches data keyword', async () => {
      const result = await decomposePositions('需要一个 数据工程师');
      const data = result.find((p) => p.title === '数据工程师');
      expect(data).toBeDefined();
      expect(data?.skills).toContain('sql');
    });
  });

  describe('default fallback', () => {
    it('returns the 全栈工程师 fallback when no keywords match', async () => {
      const result = await decomposePositions('什么也不需要，随便聊聊');
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('全栈工程师');
      expect(result[0].title_level).toBe('mid');
      // Rationale explicitly labels it as default — no black box.
      expect(result[0].rationale).toContain('默认推荐');
    });

    it('returns the fallback for empty / non-tech text', async () => {
      const result = await decomposePositions('hello world 这是一段完全无关的描述');
      expect(result.find((p) => p.title === '全栈工程师')).toBeDefined();
    });
  });

  describe('rationale field (must always be present)', () => {
    it('every suggested position has a non-empty rationale string', async () => {
      const result = await decomposePositions(
        'Vue 前端 + Java 后端 + iOS swift + 算法 ai + 数据 data',
      );
      expect(result.length).toBeGreaterThan(0);
      for (const pos of result) {
        expect(pos.rationale).toBeTruthy();
        expect(typeof pos.rationale).toBe('string');
        expect(pos.rationale.length).toBeGreaterThan(0);
      }
    });

    it('multi-keyword rationale lists every matched keyword joined with commas', async () => {
      const text = 'Need a react frontend that also knows vue and typescript';
      const result = await decomposePositions(text);
      const frontend = result.find((p) => p.title === '高级前端工程师');
      expect(frontend).toBeDefined();
      // React + frontend + vue should all appear (typescript is in skills, not keywords).
      const rationale = frontend!.rationale.toLowerCase();
      expect(rationale).toContain('react');
      expect(rationale).toContain('frontend');
      expect(rationale).toContain('vue');
      // Format starts with "匹配关键词: " prefix.
      expect(frontend!.rationale.startsWith('匹配关键词:')).toBe(true);
    });
  });

  describe('de-duplication by title', () => {
    it('a single template that matches multiple keywords only emits one entry', async () => {
      // "vue frontend 前端" all match the same template; should still emit
      // exactly one "高级前端工程师" entry.
      const result = await decomposePositions(
        'We need a senior Vue frontend 前端 engineer',
      );
      const matches = result.filter((p) => p.title === '高级前端工程师');
      expect(matches.length).toBe(1);
    });

    it('two distinct templates can both appear; titles are unique across the result', async () => {
      const result = await decomposePositions(
        '需要一个 Vue 前端 + Java 后端 + 算法工程师',
      );
      const titles = result.map((p) => p.title);
      // All titles distinct (Set.size === array.length).
      expect(new Set(titles).size).toBe(titles.length);
      // At least three templates should match.
      expect(titles.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('return shape and headcount', () => {
    it('every entry has title, skills (non-empty), title_level, headcount=1, rationale', async () => {
      const result = await decomposePositions('Need a Vue frontend engineer');
      expect(result.length).toBeGreaterThan(0);
      for (const pos of result) {
        expect(pos.title).toBeTruthy();
        expect(Array.isArray(pos.skills)).toBe(true);
        expect(pos.skills.length).toBeGreaterThan(0);
        expect(['junior', 'mid', 'senior', 'staff']).toContain(pos.title_level);
        expect(pos.headcount).toBe(1);
        expect(pos.rationale.length).toBeGreaterThan(0);
      }
    });

    it('returns DecomposedPosition[]', async () => {
      const result: DecomposedPosition[] = await decomposePositions('vue');
      expect(Array.isArray(result)).toBe(true);
      result.forEach((p) => expect(typeof p.title).toBe('string'));
    });
  });

  describe('simulated AI delay', () => {
    it('does not resolve before the 800ms sleep completes', async () => {
      vi.useFakeTimers();
      let resolved = false;
      const p = decomposePositions('vue frontend').then(() => {
        resolved = true;
      });
      // Advance 799ms — still not resolved.
      await vi.advanceTimersByTimeAsync(799);
      // Drain microtasks.
      await Promise.resolve();
      expect(resolved).toBe(false);
      // Advance the remaining 1ms.
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(resolved).toBe(true);
    });

    it('uses ~800ms wall-clock when fake timers are off (sanity check)', async () => {
      // Real timers here. Verify the elapsed time is in the right ballpark.
      const start = Date.now();
      await decomposePositions('vue');
      const elapsed = Date.now() - start;
      // Allow some scheduling slop — anywhere between 700ms and 1500ms.
      expect(elapsed).toBeGreaterThanOrEqual(700);
      expect(elapsed).toBeLessThan(1500);
    });
  });
});
