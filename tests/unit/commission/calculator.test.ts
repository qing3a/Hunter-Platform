import { describe, it, expect } from 'vitest';

describe('commission calculator', () => {
  it('default 20% platform / no referrer → primary gets full platform_fee', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: null });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(200_000);   // no referrer → primary hunter takes full
    expect(r.referrer_share).toBe(0);
    expect(r.candidate_bonus).toBe(0);
  });

  it('with referrer: splits 70/30 between primary and referrer', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({ annual_salary: 1_000_000, referrer_headhunter_id: 'h2' });
    expect(r.platform_fee).toBe(200_000);
    expect(r.primary_share).toBe(140_000);    // 70% × 200k
    expect(r.referrer_share).toBe(60_000);    // 30% × 200k
  });

  it('clamps salary to min/max (no error)', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const low = calculateCommission({ annual_salary: 50_000, referrer_headhunter_id: null });
    expect(low.platform_fee).toBe(40_000);
    const high = calculateCommission({ annual_salary: 10_000_000, referrer_headhunter_id: null });
    expect(high.platform_fee).toBe(1_000_000);
  });

  it('negative salary returns zero commission', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({ annual_salary: -100, referrer_headhunter_id: null });
    expect(r.platform_fee).toBe(0);
    expect(r.primary_share).toBe(0);
  });

  it('uses custom rates', async () => {
    const { calculateCommission } = await import('../../../src/main/modules/commission/calculator');
    const r = calculateCommission({
      annual_salary: 1_000_000, referrer_headhunter_id: 'h2',
      rates: { platform_fee_rate: 0.30, primary_share_rate: 0.60, referrer_share_rate: 0.40 },
    });
    expect(r.platform_fee).toBe(300_000);
    expect(r.primary_share).toBe(180_000);
    expect(r.referrer_share).toBe(120_000);
  });
});