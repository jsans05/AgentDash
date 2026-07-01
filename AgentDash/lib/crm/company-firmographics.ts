import type { BrandEnrichmentRow } from "@/lib/market-intel/queries";

export type CompanyFirmographics = {
  annual_revenue: number | null;
  annual_revenue_printed: string | null;
  total_funding: number | null;
  total_funding_printed: string | null;
  latest_funding_stage: string | null;
  estimated_num_employees: number | null;
  headcount_six_month_growth: number | null;
  headcount_twelve_month_growth: number | null;
  headcount_twenty_four_month_growth: number | null;
};

export const EMPTY_COMPANY_FIRMOGRAPHICS: CompanyFirmographics = {
  annual_revenue: null,
  annual_revenue_printed: null,
  total_funding: null,
  total_funding_printed: null,
  latest_funding_stage: null,
  estimated_num_employees: null,
  headcount_six_month_growth: null,
  headcount_twelve_month_growth: null,
  headcount_twenty_four_month_growth: null,
};

export const COMPANY_FIRMOGRAPHICS_DB_COLUMNS =
  "annual_revenue, annual_revenue_printed, total_funding, total_funding_printed, latest_funding_stage, estimated_num_employees, headcount_six_month_growth, headcount_twelve_month_growth, headcount_twenty_four_month_growth";

function parseOptionalNumber(raw: unknown): number | null {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function parseOptionalInt(raw: unknown): number | null {
  const n = parseOptionalNumber(raw);
  return n == null ? null : Math.round(n);
}

export function mapCompanyFirmographics(raw: Record<string, unknown> | null | undefined): CompanyFirmographics {
  if (!raw) return { ...EMPTY_COMPANY_FIRMOGRAPHICS };
  return {
    annual_revenue: parseOptionalInt(raw.annual_revenue),
    annual_revenue_printed:
      raw.annual_revenue_printed != null ? String(raw.annual_revenue_printed).trim() || null : null,
    total_funding: parseOptionalInt(raw.total_funding),
    total_funding_printed:
      raw.total_funding_printed != null ? String(raw.total_funding_printed).trim() || null : null,
    latest_funding_stage:
      raw.latest_funding_stage != null ? String(raw.latest_funding_stage).trim() || null : null,
    estimated_num_employees: parseOptionalInt(raw.estimated_num_employees),
    headcount_six_month_growth: parseOptionalNumber(raw.headcount_six_month_growth),
    headcount_twelve_month_growth: parseOptionalNumber(raw.headcount_twelve_month_growth),
    headcount_twenty_four_month_growth: parseOptionalNumber(raw.headcount_twenty_four_month_growth),
  };
}

export function firmographicsFromBrandEnrichment(row: BrandEnrichmentRow): CompanyFirmographics {
  return {
    annual_revenue: row.annual_revenue,
    annual_revenue_printed: row.annual_revenue_printed,
    total_funding: row.total_funding,
    total_funding_printed: row.total_funding_printed,
    latest_funding_stage: row.latest_funding_stage,
    estimated_num_employees: row.estimated_num_employees,
    headcount_six_month_growth: row.headcount_six_month_growth,
    headcount_twelve_month_growth: row.headcount_twelve_month_growth,
    headcount_twenty_four_month_growth: row.headcount_twenty_four_month_growth,
  };
}

export function hasCompanyFirmographics(f: CompanyFirmographics): boolean {
  return (
    f.annual_revenue != null ||
    Boolean(f.annual_revenue_printed) ||
    f.total_funding != null ||
    Boolean(f.total_funding_printed) ||
    Boolean(f.latest_funding_stage) ||
    f.estimated_num_employees != null ||
    f.headcount_six_month_growth != null ||
    f.headcount_twelve_month_growth != null ||
    f.headcount_twenty_four_month_growth != null
  );
}

export function formatRevenueDisplay(f: CompanyFirmographics): string | null {
  if (f.annual_revenue_printed) return f.annual_revenue_printed;
  const rev = f.annual_revenue;
  if (rev == null) return null;
  if (rev >= 1_000_000_000) return `$${(rev / 1_000_000_000).toFixed(1)}B`;
  if (rev >= 1_000_000) return `$${(rev / 1_000_000).toFixed(1)}M`;
  return `$${rev.toLocaleString()}`;
}

export function formatFundingDisplay(f: CompanyFirmographics): string | null {
  if (f.total_funding_printed) return f.total_funding_printed;
  const funding = f.total_funding;
  if (funding == null) return null;
  if (funding >= 1_000_000_000) return `$${(funding / 1_000_000_000).toFixed(1)}B`;
  if (funding >= 1_000_000) return `$${(funding / 1_000_000).toFixed(1)}M`;
  return `$${funding.toLocaleString()}`;
}

export function formatGrowthPercent(value: number | null): string | null {
  if (value == null || Number.isNaN(value)) return null;
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatFirmographicsExport(f: CompanyFirmographics): string {
  const lines: string[] = [];
  const revenue = formatRevenueDisplay(f);
  if (revenue) lines.push(`Revenue: ${revenue}`);
  const funding = formatFundingDisplay(f);
  if (funding || f.latest_funding_stage) {
    lines.push(`Funding: ${[funding, f.latest_funding_stage].filter(Boolean).join(" · ")}`);
  }
  if (f.estimated_num_employees != null) {
    lines.push(`Employees: ${f.estimated_num_employees.toLocaleString()}`);
  }
  const growthParts = [
    f.headcount_six_month_growth != null
      ? `6mo ${formatGrowthPercent(f.headcount_six_month_growth)}`
      : null,
    f.headcount_twelve_month_growth != null
      ? `12mo ${formatGrowthPercent(f.headcount_twelve_month_growth)}`
      : null,
    f.headcount_twenty_four_month_growth != null
      ? `24mo ${formatGrowthPercent(f.headcount_twenty_four_month_growth)}`
      : null,
  ].filter(Boolean);
  if (growthParts.length > 0) {
    lines.push(`Headcount: ${growthParts.join(", ")}`);
  }
  return lines.join("\n");
}

export function firmographicsPatchFromPartial(
  partial: Partial<CompanyFirmographics>
): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {};
  if (partial.annual_revenue !== undefined) patch.annual_revenue = partial.annual_revenue;
  if (partial.annual_revenue_printed !== undefined) {
    patch.annual_revenue_printed = partial.annual_revenue_printed;
  }
  if (partial.total_funding !== undefined) patch.total_funding = partial.total_funding;
  if (partial.total_funding_printed !== undefined) {
    patch.total_funding_printed = partial.total_funding_printed;
  }
  if (partial.latest_funding_stage !== undefined) {
    patch.latest_funding_stage = partial.latest_funding_stage;
  }
  if (partial.estimated_num_employees !== undefined) {
    patch.estimated_num_employees = partial.estimated_num_employees;
  }
  if (partial.headcount_six_month_growth !== undefined) {
    patch.headcount_six_month_growth = partial.headcount_six_month_growth;
  }
  if (partial.headcount_twelve_month_growth !== undefined) {
    patch.headcount_twelve_month_growth = partial.headcount_twelve_month_growth;
  }
  if (partial.headcount_twenty_four_month_growth !== undefined) {
    patch.headcount_twenty_four_month_growth = partial.headcount_twenty_four_month_growth;
  }
  if (hasCompanyFirmographics({ ...EMPTY_COMPANY_FIRMOGRAPHICS, ...partial })) {
    patch.firmographics_enriched_at = new Date().toISOString();
  }
  return patch;
}

export function firmographicsPatchFromImportRow(
  raw: Record<string, unknown>
): Record<string, string | number | null> {
  return firmographicsPatchFromPartial({
    annual_revenue: parseOptionalInt(raw.annual_revenue),
    annual_revenue_printed:
      raw.annual_revenue_printed != null ? String(raw.annual_revenue_printed).trim() || null : undefined,
    total_funding: parseOptionalInt(raw.total_funding),
    total_funding_printed:
      raw.total_funding_printed != null ? String(raw.total_funding_printed).trim() || null : undefined,
    latest_funding_stage:
      raw.latest_funding_stage != null ? String(raw.latest_funding_stage).trim() || null : undefined,
    estimated_num_employees: parseOptionalInt(raw.estimated_num_employees),
    headcount_six_month_growth: parseOptionalNumber(raw.headcount_six_month_growth),
    headcount_twelve_month_growth: parseOptionalNumber(raw.headcount_twelve_month_growth),
    headcount_twenty_four_month_growth: parseOptionalNumber(raw.headcount_twenty_four_month_growth),
  });
}
