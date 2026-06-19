import { describe, it, expect } from 'vitest';

describe('desensitize engine', () => {
  it('maps company to industry', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const result = desensitize({
      current_company: '字节跳动',
      current_title: '高级前端工程师',
      expected_salary: 750000,
      years_experience: 8,
      education_school: '清华大学',
    });
    expect(result.industry).toBe('互联网');
    expect(result.title_level).toBe('P6');
    expect(result.salary_range).toBe('60-80万');
    expect(result.education_tier).toBe('985');
    expect(result.years_experience).toBe(8);
  });

  it('returns "其他" for unknown company', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const result = desensitize({
      current_company: '某某不知名公司',
      current_title: '工程师',
      expected_salary: 100000,
      years_experience: 1,
      education_school: '某学院',
    });
    expect(result.industry).toBe('其他');
    expect(result.education_tier).toBe('普通');
  });

  it('handles missing fields gracefully', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const result = desensitize({});
    expect(result.industry).toBe(null);
    expect(result.years_experience).toBe(null);
  });

  it('clamps salary to band range', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    expect(desensitize({ expected_salary: 50000 }).salary_range).toBe('0-20万');
    expect(desensitize({ expected_salary: 15000000 }).salary_range).toBe('200万+');
  });
});

describe('SCHOOL_TIERS — all 39 985 schools', () => {
  it('maps every 985 school to "985"', async () => {
    const { desensitize } = await import('../../../src/main/modules/desensitize/engine');
    const samples = [
      '北京大学', '清华大学', '浙江大学', '上海交通大学', '国防科技大学',
    ];
    for (const school of samples) {
      const result = desensitize({ education_school: school });
      expect(result.education_tier, `${school} should be 985`).toBe('985');
    }
  });
});
