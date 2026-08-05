import type { BrandEnrichmentRow } from "@/lib/market-intel/queries";

export type CompanyFirmographics = {
  annual_revenue: number | null;
  annual_revenue_printed: string | null;
  total_funding: number | null;
  total_funding_printed: string | null;
  latest_funding_stage: string | null;
  latest_funding_round_date: string | null;
  estimated_num_employees: number | null;
  headcount_six_month_growth: number | null;
  headcount_twelve_month_growth: number | null;
  headcount_twenty_four_month_growth: number | null;
  domain: string | null;
  match_confidence: string | null;
  match_notes: string | null;
  firmographics_enriched_at: string | null;
  departmental_head_count: Record<string, number> | null;
  ticker: string | null;
  stock_symbol: string | null;
  stock_symbol_override: string | null;
  exchange: string | null;
  stock_currency: string | null;
  market_cap: number | null;
  share_price: number | null;
  share_price_change_pct: number | null;
  stock_change_5d_pct: number | null;
  stock_change_3m_pct: number | null;
  stock_change_12m_pct: number | null;
  stock_52w_high: number | null;
  stock_52w_low: number | null;
  stock_beta: number | null;
  stock_sparkline: unknown;
  market_data_as_of: string | null;
  open_jobs_count: number | null;
  open_jobs_source: string | null;
  open_jobs_as_of: string | null;
  instagram_handle: string | null;
  facebook_page_url: string | null;
  meta_page_id: string | null;
  meta_ads_library_url: string | null;
  meta_ads_latest_start: string | null;
  meta_ads_active_count: number | null;
  meta_ads_status: string | null;
  meta_ads_as_of: string | null;
  spend_readiness_score: number | null;
  spend_readiness_label: string | null;
};

export const EMPTY_COMPANY_FIRMOGRAPHICS: CompanyFirmographics = {
  annual_revenue: null,
  annual_revenue_printed: null,
  total_funding: null,
  total_funding_printed: null,
  latest_funding_stage: null,
  latest_funding_round_date: null,
  estimated_num_employees: null,
  headcount_six_month_growth: null,
  headcount_twelve_month_growth: null,
  headcount_twenty_four_month_growth: null,
  domain: null,
  match_confidence: null,
  match_notes: null,
  firmographics_enriched_at: null,
  departmental_head_count: null,
  ticker: null,
  stock_symbol: null,
  stock_symbol_override: null,
  exchange: null,
  stock_currency: null,
  market_cap: null,
  share_price: null,
  share_price_change_pct: null,
  stock_change_5d_pct: null,
  stock_change_3m_pct: null,
  stock_change_12m_pct: null,
  stock_52w_high: null,
  stock_52w_low: null,
  stock_beta: null,
  stock_sparkline: null,
  market_data_as_of: null,
  open_jobs_count: null,
  open_jobs_source: null,
  open_jobs_as_of: null,
  instagram_handle: null,
  facebook_page_url: null,
  meta_page_id: null,
  meta_ads_library_url: null,
  meta_ads_latest_start: null,
  meta_ads_active_count: null,
  meta_ads_status: null,
  meta_ads_as_of: null,
  spend_readiness_score: null,
  spend_readiness_label: null,
};

export const COMPANY_FIRMOGRAPHICS_DB_COLUMNS =
  "annual_revenue, annual_revenue_printed, total_funding, total_funding_printed, latest_funding_stage, latest_funding_round_date, estimated_num_employees, headcount_six_month_growth, headcount_twelve_month_growth, headcount_twenty_four_month_growth, domain, match_confidence, match_notes, firmographics_enriched_at, departmental_head_count, ticker, stock_symbol, stock_symbol_override, exchange, stock_currency, market_cap, share_price, share_price_change_pct, stock_change_5d_pct, stock_change_3m_pct, stock_change_12m_pct, stock_52w_high, stock_52w_low, stock_beta, stock_sparkline, market_data_as_of, open_jobs_count, open_jobs_source, open_jobs_as_of, instagram_handle, facebook_page_url, meta_page_id, meta_ads_library_url, meta_ads_latest_start, meta_ads_active_count, meta_ads_status, meta_ads_as_of, spend_readiness_score, spend_readiness_label";

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

function parseOptionalString(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function parseDepartmentalHeadCount(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = parseOptionalInt(value);
    if (n != null) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function mapCompanyFirmographics(raw: Record<string, unknown> | null | undefined): CompanyFirmographics {
  if (!raw) return { ...EMPTY_COMPANY_FIRMOGRAPHICS };
  return {
    annual_revenue: parseOptionalInt(raw.annual_revenue),
    annual_revenue_printed: parseOptionalString(raw.annual_revenue_printed),
    total_funding: parseOptionalInt(raw.total_funding),
    total_funding_printed: parseOptionalString(raw.total_funding_printed),
    latest_funding_stage: parseOptionalString(raw.latest_funding_stage),
    latest_funding_round_date: parseOptionalString(raw.latest_funding_round_date),
    estimated_num_employees: parseOptionalInt(raw.estimated_num_employees),
    headcount_six_month_growth: parseOptionalNumber(raw.headcount_six_month_growth),
    headcount_twelve_month_growth: parseOptionalNumber(raw.headcount_twelve_month_growth),
    headcount_twenty_four_month_growth: parseOptionalNumber(raw.headcount_twenty_four_month_growth),
    domain: parseOptionalString(raw.domain),
    match_confidence: parseOptionalString(raw.match_confidence),
    match_notes: parseOptionalString(raw.match_notes),
    firmographics_enriched_at: parseOptionalString(raw.firmographics_enriched_at),
    departmental_head_count: parseDepartmentalHeadCount(raw.departmental_head_count),
    ticker: parseOptionalString(raw.ticker),
    stock_symbol: parseOptionalString(raw.stock_symbol),
    stock_symbol_override: parseOptionalString(raw.stock_symbol_override),
    exchange: parseOptionalString(raw.exchange),
    stock_currency: parseOptionalString(raw.stock_currency),
    market_cap: parseOptionalInt(raw.market_cap),
    share_price: parseOptionalNumber(raw.share_price),
    share_price_change_pct: parseOptionalNumber(raw.share_price_change_pct),
    stock_change_5d_pct: parseOptionalNumber(raw.stock_change_5d_pct),
    stock_change_3m_pct: parseOptionalNumber(raw.stock_change_3m_pct),
    stock_change_12m_pct: parseOptionalNumber(raw.stock_change_12m_pct),
    stock_52w_high: parseOptionalNumber(raw.stock_52w_high),
    stock_52w_low: parseOptionalNumber(raw.stock_52w_low),
    stock_beta: parseOptionalNumber(raw.stock_beta),
    stock_sparkline: raw.stock_sparkline ?? null,
    market_data_as_of: parseOptionalString(raw.market_data_as_of),
    open_jobs_count: parseOptionalInt(raw.open_jobs_count),
    open_jobs_source: parseOptionalString(raw.open_jobs_source),
    open_jobs_as_of: parseOptionalString(raw.open_jobs_as_of),
    instagram_handle: parseOptionalString(raw.instagram_handle),
    facebook_page_url: parseOptionalString(raw.facebook_page_url),
    meta_page_id: parseOptionalString(raw.meta_page_id),
    meta_ads_library_url: parseOptionalString(raw.meta_ads_library_url),
    meta_ads_latest_start: parseOptionalString(raw.meta_ads_latest_start),
    meta_ads_active_count: parseOptionalInt(raw.meta_ads_active_count),
    meta_ads_status: parseOptionalString(raw.meta_ads_status),
    meta_ads_as_of: parseOptionalString(raw.meta_ads_as_of),
    spend_readiness_score: parseOptionalInt(raw.spend_readiness_score),
    spend_readiness_label: parseOptionalString(raw.spend_readiness_label),
  };
}

export function firmographicsFromBrandEnrichment(row: BrandEnrichmentRow): CompanyFirmographics {
  return mapCompanyFirmographics(row as unknown as Record<string, unknown>);
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
    f.headcount_twenty_four_month_growth != null ||
    Boolean(f.ticker) ||
    Boolean(f.stock_symbol) ||
    Boolean(f.stock_symbol_override) ||
    f.open_jobs_count != null ||
    Boolean(f.meta_ads_library_url) ||
    Boolean(f.instagram_handle)
  );
}

export function isFirmographicsStale(enrichedAt: string | null, staleDays = 90): boolean {
  if (!enrichedAt) return false;
  const ageMs = Date.now() - new Date(enrichedAt).getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
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

export function formatDepartmentalSummary(
  departmental: Record<string, number> | null | undefined
): string | null {
  if (!departmental) return null;
  const keys = ["marketing", "sales", "business_development", "partnerships"] as const;
  const parts = keys
    .map((key) => {
      const count = departmental[key];
      if (count == null) return null;
      const label = key.replace(/_/g, " ");
      return `${label}: ${count.toLocaleString()}`;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatStockDisplay(f: CompanyFirmographics): string | null {
  if (!f.ticker) return null;
  const change = formatGrowthPercent(f.share_price_change_pct);
  const price =
    f.share_price != null ? `$${f.share_price.toFixed(2)}` : null;
  const parts = [f.ticker, price, change].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : f.ticker;
}

export function formatMetaAdsDisplay(
  f: CompanyFirmographics,
  brandName?: string | null
): string | null {
  const brand = brandName?.trim();
  const pageLinkLabel = brand
    ? `View ${brand}'s active Meta ads`
    : "View active Meta ads";

  if (f.meta_ads_library_url?.includes("search_type=page")) {
    if (f.meta_page_id) {
      if (f.meta_ads_status === "active" && f.meta_ads_latest_start) {
        return `${pageLinkLabel} · since ${new Date(f.meta_ads_latest_start).toLocaleDateString()}`;
      }
      if (f.meta_ads_status === "active" || f.meta_ads_status === "library_link_only") {
        return pageLinkLabel;
      }
    }
    if (f.meta_ads_status === "page_search") {
      return pageLinkLabel;
    }
  }

  if (f.meta_ads_status === "keyword_search") {
    return "Keyword search (page not verified)";
  }
  if (f.meta_ads_status === "not_found") return null;
  return null;
}

export function formatFirmographicsExport(f: CompanyFirmographics): string {
  const lines: string[] = [];
  const revenue = formatRevenueDisplay(f);
  if (revenue) lines.push(`Revenue: ${revenue}`);
  const funding = formatFundingDisplay(f);
  if (funding || f.latest_funding_stage) {
    lines.push(`Funding: ${[funding, f.latest_funding_stage].filter(Boolean).join(" · ")}`);
  }
  if (f.latest_funding_round_date) {
    lines.push(`Latest funding round: ${new Date(f.latest_funding_round_date).toLocaleDateString()}`);
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
  const dept = formatDepartmentalSummary(f.departmental_head_count);
  if (dept) lines.push(`Departments: ${dept}`);
  const stock = formatStockDisplay(f);
  if (stock) lines.push(`Stock: ${stock}`);
  if (f.open_jobs_count != null) {
    lines.push(`Open jobs: ${f.open_jobs_count}${f.open_jobs_source ? ` (${f.open_jobs_source})` : ""}`);
  }
  if (f.instagram_handle) lines.push(`Instagram: @${f.instagram_handle.replace(/^@/, "")}`);
  const meta = formatMetaAdsDisplay(f);
  if (meta) lines.push(`Meta ads: ${meta}`);
  if (f.spend_readiness_label) lines.push(`Spend readiness: ${f.spend_readiness_label}`);
  return lines.join("\n");
}

export function firmographicsPatchFromPartial(
  partial: Partial<CompanyFirmographics>
): Record<string, string | number | null | Record<string, number> | unknown> {
  const patch: Record<string, string | number | null | Record<string, number> | unknown> = {};
  const keys = Object.keys(EMPTY_COMPANY_FIRMOGRAPHICS) as Array<keyof CompanyFirmographics>;
  for (const key of keys) {
    if (partial[key] !== undefined) {
      patch[key] = partial[key] as string | number | null | Record<string, number> | unknown;
    }
  }
  if (hasCompanyFirmographics({ ...EMPTY_COMPANY_FIRMOGRAPHICS, ...partial })) {
    patch.firmographics_enriched_at = new Date().toISOString();
  }
  return patch;
}

export function firmographicsPatchFromImportRow(
  raw: Record<string, unknown>
): Record<string, string | number | null | Record<string, number> | unknown> {
  return firmographicsPatchFromPartial(mapCompanyFirmographics(raw));
}

export type OrgCandidatePublic = {
  apollo_organization_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  score: number;
  primary_domain: string | null;
  match_confidence: "high" | "medium" | "low";
  selected: boolean;
};
