const EMPLOYEE_BRACKETS: Array<[number, number]> = [
  [1, 10],
  [11, 50],
  [51, 200],
  [201, 500],
  [501, 1000],
  [1001, 5000],
  [5001, 10000],
  [10001, 100000],
];

export function domainFromWebsite(website: string | null | undefined): string | null {
  const raw = String(website ?? "").trim();
  if (!raw) return null;
  try {
    const url = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    const cleaned = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
    return cleaned?.toLowerCase() || null;
  }
}

export function employeeRangeBracket(employeeCount: number): string {
  const n = Math.floor(employeeCount);
  for (const [min, max] of EMPLOYEE_BRACKETS) {
    if (n >= min && n <= max) return `${min},${max}`;
  }
  if (n > 10000) return "10001,100000";
  return "1,10";
}

export function revenueRangeFromSeed(
  annualRevenue: number | null | undefined,
  opts?: { marginPercent?: number; overrideMin?: number; overrideMax?: number }
): { min?: number; max?: number } {
  if (opts?.overrideMin != null || opts?.overrideMax != null) {
    return { min: opts.overrideMin, max: opts.overrideMax };
  }
  const rev = annualRevenue != null && Number.isFinite(annualRevenue) ? Math.floor(annualRevenue) : null;
  if (rev == null || rev <= 0) return {};
  const margin = opts?.marginPercent ?? 50;
  const factor = margin / 100;
  const min = Math.max(1, Math.floor(rev * (1 - factor)));
  const max = Math.floor(rev * (1 + factor));
  return { min, max };
}

export function normalizeDomainForCompare(domain: string | null | undefined): string {
  return String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./i, "");
}

export function mapRawOrganization(raw: Record<string, unknown>): import("@/lib/apollo/org-search-types").ApolloOrganizationResult {
  const primary_domain =
    raw.primary_domain != null ? String(raw.primary_domain).replace(/^www\./i, "") : undefined;
  const website =
    primary_domain != null
      ? `https://${primary_domain}`
      : raw.website_url != null
        ? String(raw.website_url)
        : undefined;

  const annual_revenue =
    typeof raw.annual_revenue === "number"
      ? raw.annual_revenue
      : typeof raw.estimated_annual_revenue === "number"
        ? raw.estimated_annual_revenue
        : undefined;

  return {
    apollo_organization_id: raw.id != null ? String(raw.id) : null,
    name: String(raw.name ?? "Unknown").trim() || "Unknown",
    industry: raw.industry != null ? String(raw.industry) : undefined,
    website,
    description:
      raw.short_description != null
        ? String(raw.short_description)
        : raw.seo_description != null
          ? String(raw.seo_description)
          : undefined,
    primary_domain,
    estimated_num_employees:
      typeof raw.estimated_num_employees === "number" ? raw.estimated_num_employees : undefined,
    annual_revenue,
    city: raw.city != null ? String(raw.city) : undefined,
    state: raw.state != null ? String(raw.state) : undefined,
    country: raw.country != null ? String(raw.country) : undefined,
  };
}

import { extractOrgPhone } from "@/lib/apollo/phone-utils";
import type {
  ApolloEnrichedOrganization,
  ApolloFundingEvent,
} from "@/lib/apollo/org-search-types";

function parseGrowthPercent(raw: unknown): number | null {
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  return null;
}

function mapFundingEvents(raw: unknown): ApolloFundingEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ApolloFundingEvent | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        date: row.date != null ? String(row.date) : undefined,
        type: row.type != null ? String(row.type) : undefined,
        amount: row.amount != null ? String(row.amount) : undefined,
        investors: row.investors != null ? String(row.investors) : undefined,
        currency: row.currency != null ? String(row.currency) : undefined,
      };
    })
    .filter((e): e is ApolloFundingEvent => e != null);
}

function mapDepartmentalHeadCount(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && !Number.isNaN(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function emptyApolloEnrichedOrganization(
  partial?: Partial<ApolloEnrichedOrganization>
): ApolloEnrichedOrganization {
  return {
    apollo_organization_id: null,
    name: null,
    website: null,
    industry: null,
    description: null,
    primary_domain: null,
    hq_phone: null,
    estimated_num_employees: null,
    annual_revenue: null,
    annual_revenue_printed: null,
    total_funding: null,
    total_funding_printed: null,
    latest_funding_stage: null,
    latest_funding_round_date: null,
    funding_events: [],
    headcount_six_month_growth: null,
    headcount_twelve_month_growth: null,
    headcount_twenty_four_month_growth: null,
    departmental_head_count: null,
    city: null,
    state: null,
    country: null,
    keyword_tags: [],
    ...partial,
  };
}

export function mapHeadcountTrendsFromOrg(
  org: Record<string, unknown>
): Pick<
  ApolloEnrichedOrganization,
  | "headcount_six_month_growth"
  | "headcount_twelve_month_growth"
  | "headcount_twenty_four_month_growth"
  | "departmental_head_count"
  | "estimated_num_employees"
> {
  return {
    headcount_six_month_growth: parseGrowthPercent(org.organization_headcount_six_month_growth),
    headcount_twelve_month_growth: parseGrowthPercent(
      org.organization_headcount_twelve_month_growth
    ),
    headcount_twenty_four_month_growth: parseGrowthPercent(
      org.organization_headcount_twenty_four_month_growth
    ),
    departmental_head_count: mapDepartmentalHeadCount(org.departmental_head_count),
    estimated_num_employees:
      typeof org.estimated_num_employees === "number" ? org.estimated_num_employees : null,
  };
}

export function mapEnrichedOrganization(org: Record<string, unknown>): ApolloEnrichedOrganization {
  const primary_domain =
    org.primary_domain != null ? String(org.primary_domain).replace(/^www\./i, "") : null;
  const tags: string[] = [];
  if (org.industry) tags.push(String(org.industry));
  if (Array.isArray(org.secondary_industries)) {
    for (const t of org.secondary_industries) {
      if (t) tags.push(String(t));
    }
  }
  if (Array.isArray(org.keywords)) {
    for (const k of org.keywords) {
      if (k) tags.push(String(k));
    }
  }

  return {
    apollo_organization_id: org.id != null ? String(org.id) : null,
    name: org.name != null ? String(org.name) : null,
    website:
      primary_domain != null
        ? `https://${primary_domain}`
        : org.website_url != null
          ? String(org.website_url)
          : null,
    industry: org.industry != null ? String(org.industry) : null,
    description:
      org.short_description != null
        ? String(org.short_description)
        : org.seo_description != null
          ? String(org.seo_description)
          : null,
    primary_domain,
    hq_phone: extractOrgPhone(org),
    annual_revenue: typeof org.annual_revenue === "number" ? org.annual_revenue : null,
    annual_revenue_printed:
      org.annual_revenue_printed != null ? String(org.annual_revenue_printed) : null,
    total_funding: typeof org.total_funding === "number" ? org.total_funding : null,
    total_funding_printed:
      org.total_funding_printed != null ? String(org.total_funding_printed) : null,
    latest_funding_stage:
      org.latest_funding_stage != null ? String(org.latest_funding_stage) : null,
    latest_funding_round_date:
      org.latest_funding_round_date != null ? String(org.latest_funding_round_date) : null,
    funding_events: mapFundingEvents(org.funding_events),
    ...mapHeadcountTrendsFromOrg(org),
    city: org.city != null ? String(org.city) : null,
    state: org.state != null ? String(org.state) : null,
    country: org.country != null ? String(org.country) : null,
    keyword_tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
  };
}
