import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
export type SpendReadinessInput = {
  firmographics: CompanyFirmographics;
  latestFundingRoundDate?: string | null;
  openJobsCount?: number | null;
  sharePriceChangePct?: number | null;
  metaAdsStatus?: string | null;
  metaAdsActiveCount?: number | null;
};
export type SpendReadinessResult = {
  spend_readiness_score: number | null;
  spend_readiness_label: string | null;
};
export function computeSpendReadiness(input: SpendReadinessInput): SpendReadinessResult {
  let score = 0;
  const signals: string[] = [];
  const rev = input.firmographics.annual_revenue;
  if (rev != null) {
    if (rev >= 1_000_000_000) {
      score += 30;
      signals.push("Large revenue");
    } else if (rev >= 100_000_000) {
      score += 22;
      signals.push("Strong revenue");
    } else if (rev >= 10_000_000) {
      score += 14;
      signals.push("Mid-market revenue");
    } else if (rev >= 1_000_000) {
      score += 6;
    }
  }
  const employees = input.firmographics.estimated_num_employees;
  if (employees != null) {
    if (employees >= 1000) score += 10;else if (employees >= 200) score += 6;else if (employees >= 50) score += 3;
  }
  const funding = input.firmographics.total_funding;
  if (funding != null && funding >= 10_000_000) {
    score += 12;
    signals.push("Funded");
  } else if (input.firmographics.latest_funding_stage) {
    score += 6;
  }
  const growth12 = input.firmographics.headcount_twelve_month_growth;
  if (growth12 != null) {
    if (growth12 >= 10) {
      score += 10;
      signals.push("Growing headcount");
    } else if (growth12 >= 0) {
      score += 4;
    } else if (growth12 <= -10) {
      score -= 8;
      signals.push("Contracting headcount");
    }
  }
  const jobs = input.openJobsCount;
  if (jobs != null) {
    if (jobs >= 20) {
      score += 8;
      signals.push("Hiring actively");
    } else if (jobs >= 5) {
      score += 4;
    }
  }
  const stockChange = input.sharePriceChangePct;
  if (stockChange != null) {
    if (stockChange >= 5) score += 6;else if (stockChange <= -15) score -= 6;
  }
  if (input.metaAdsStatus === "active") {
    score += 10;
    signals.push("Running Meta ads");
  } else if (input.metaAdsStatus === "library_link_only") {
    score += 4;
  }
  if (input.latestFundingRoundDate) {
    const monthsAgo = (Date.now() - new Date(input.latestFundingRoundDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsAgo <= 18) {
      score += 8;
      signals.push("Recent funding");
    }
  }
  score = Math.max(0, Math.min(100, score));
  let label: string | null = null;
  if (score >= 70) label = "High";else if (score >= 45) label = "Moderate";else if (score >= 20) label = "Limited";else label = "Low";
  if (signals.length === 0 && score === 0) {
    return {
      spend_readiness_score: null,
      spend_readiness_label: null
    };
  }
  return {
    spend_readiness_score: score,
    spend_readiness_label: `${label} (est.)`
  };
}