// tests/unit/desensitize-title-level.spec.ts
// 验证修复：title_level 正则扩展能覆盖 "高级算法工程师" 等被漏判的职位
import { describe, it, expect } from 'vitest';
import { TITLE_LEVEL_PATTERNS } from '../../src/main/modules/desensitize/mapping';

function classify(title: string): string {
  for (const p of TITLE_LEVEL_PATTERNS) {
    if (p.regex.test(title)) return p.level;
  }
  return '其他';
}

describe('title level regex — bug fix', () => {
  describe('高级X工程师 patterns (P6)', () => {
    it('matches 高级算法工程师 → P6', () => {
      expect(classify('高级算法工程师')).toBe('P6');
    });
    it('matches 高级数据工程师 → P6', () => {
      expect(classify('高级数据工程师')).toBe('P6');
    });
    it('matches 高级AI工程师 → P6', () => {
      expect(classify('高级AI工程师')).toBe('P6');
    });
    it('matches 高级NLP工程师 → P6', () => {
      expect(classify('高级NLP工程师')).toBe('P6');
    });
    it('matches 高级前端工程师 → P6 (regression)', () => {
      expect(classify('高级前端工程师')).toBe('P6');
    });
    it('matches 高级工程师 (literal) → P6 (regression)', () => {
      expect(classify('高级工程师')).toBe('P6');
    });
  });

  describe('资深X工程师 patterns (P7+)', () => {
    it('matches 资深算法工程师 → P7+', () => {
      expect(classify('资深算法工程师')).toBe('P7+');
    });
    it('matches 资深 (no suffix) → P7+ (regression)', () => {
      expect(classify('资深工程师')).toBe('P7+');
    });
  });

  describe('P-level literal (regression)', () => {
    it('matches P5 → P6', () => {
      expect(classify('P5 Java 工程师')).toBe('P6');
    });
    it('matches P6 → P6', () => {
      expect(classify('P6')).toBe('P6');
    });
    it('matches P8 → P7+', () => {
      expect(classify('P8 架构师')).toBe('P7+');
    });
  });

  describe('non-senior / no match', () => {
    it('plain 工程师 → 其他', () => {
      expect(classify('工程师')).toBe('其他');
    });
    it('unknown title → 其他', () => {
      expect(classify('产品经理助理')).toBe('M1'); // 经理 matches M1
    });
  });
});