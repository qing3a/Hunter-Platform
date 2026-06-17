export interface CommissionRates {
  platform_fee_rate: number;
  primary_share_rate: number;
  referrer_share_rate: number;
}

export interface CommissionInput {
  annual_salary: number;
  referrer_headhunter_id: string | null;
  rates?: Partial<CommissionRates>;
  salary_min?: number;
  salary_max?: number;
}

export interface CommissionResult {
  platform_fee: number;
  primary_share: number;
  referrer_share: number;
  candidate_bonus: number;
  clamped_salary: number;
}

const DEFAULT_RATES: CommissionRates = {
  platform_fee_rate: 0.20,
  primary_share_rate: 0.70,
  referrer_share_rate: 0.30,
};

export function calculateCommission(input: CommissionInput): CommissionResult {
  const rates: CommissionRates = { ...DEFAULT_RATES, ...(input.rates ?? {}) };
  const min = input.salary_min ?? 200_000;
  const max = input.salary_max ?? 5_000_000;
  // Negative or zero salary → zero commission. Otherwise clamp to [min, max].
  const clamped = input.annual_salary <= 0
    ? 0
    : Math.min(max, Math.max(min, input.annual_salary));

  if (clamped === 0) {
    return { platform_fee: 0, primary_share: 0, referrer_share: 0, candidate_bonus: 0, clamped_salary: 0 };
  }

  const platform_fee = Math.round(clamped * rates.platform_fee_rate);

  let primary_share: number;
  let referrer_share: number;
  if (input.referrer_headhunter_id) {
    primary_share = Math.round(platform_fee * rates.primary_share_rate);
    referrer_share = Math.round(platform_fee * rates.referrer_share_rate);
  } else {
    primary_share = platform_fee;
    referrer_share = 0;
  }

  return {
    platform_fee,
    primary_share,
    referrer_share,
    candidate_bonus: 0,
    clamped_salary: clamped,
  };
}