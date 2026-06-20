// tests/unit/commission-split.test.ts
import { describe, it, expect } from 'vitest';
import { calculateCommission } from '../../src/main/modules/commission/calculator';
import { COMMISSION_SPLIT_HEADHUNTER_CREATED } from '../../src/shared/constants';

describe('commission split - headhunter created job (pure logic)', () => {
  // 模拟"如果 source_headhunter_id != null && != rec.headhunter_id" 的入参逻辑
  // 因为 createPlacement 才是真判断的地方, 这里只测 calculateCommission 透传 referrer_headhunter_id

  it('同 referrer 100% (雇主直发老逻辑)', () => {
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: null });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(200_000);
    expect(r.referrer_share).toBe(0);
  });

  it('有 referrer 时 70/30 split (老 referral 逻辑)', () => {
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: 'u_ref' });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(140_000);  // 70%
    expect(r.referrer_share).toBe(60_000);  // 30%
  });

  it('createPlacement 把 job.source_headhunter_id 当 referrer 时: 30% 给建岗猎头', () => {
    // 这是 spec §5.4 角色映射表里的"跨人"情形
    const r = calculateCommission({
      annual_salary: 1_000_000,
      referrer_headhunter_id: 'u_hh_creator',  // 来自 job.source_headhunter_id
    });
    expect(r.referrer_share).toBe(60_000);
    expect(r.primary_share).toBe(140_000);
    // 验证 split 比例与 spec 一致
    expect(COMMISSION_SPLIT_HEADHUNTER_CREATED.recommender).toBe(0.7);
    expect(COMMISSION_SPLIT_HEADHUNTER_CREATED.creator).toBe(0.3);
  });
});
