/** Refine-search placeholders only; default Find contacts uses departments below. */
export const APOLLO_DEFAULT_PERSON_TITLES = [
  "marketing",
  "partnership",
  "partnerships",
  "influencer",
  "brand",
] as const;

export const APOLLO_DEFAULT_PERSON_SENIORITIES = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
] as const;

/**
 * Apollo person_department_or_subdepartments values for default Find contacts:
 * Marketing & Design → Brand Design; Sales → Business Development + Partnerships.
 */
export const APOLLO_DEFAULT_PERSON_DEPARTMENTS = [
  "brand_design",
  "business_development",
  "partnerships",
] as const;

export const APOLLO_DEFAULT_CONTACT_EMAIL_STATUS = ["verified"] as const;

export const APOLLO_DEFAULT_INCLUDE_SIMILAR_TITLES = true;

/** Default Find contacts: target departments + verified email; fallback to any verified title. */
export type ApolloContactSearchMode = "partnership" | "all_verified";

export function formatApolloPartnershipSearchSummary(): string {
  return (
    "Departments & job function: Marketing & Design (Brand Design only) and " +
    "Sales (Business Development, Partnerships). Verified email only. " +
    "If no matches, automatically searches any verified contact at the company."
  );
}

export function formatApolloAllVerifiedSearchSummary(): string {
  return "Any job title at this company with a verified email in Apollo.";
}

export type ApolloPeopleSearchOverrides = {
  organization_locations?: string[];
  person_locations?: string[];
  revenue_range_min?: number;
  revenue_range_max?: number;
  q_keywords?: string;
  person_titles?: string[];
  person_seniorities?: string[];
  person_departments?: string[];
  page?: number;
  per_page?: number;
};

/** Client / API request shape for Apollo contact search filters. */
export type ApolloContactSearchOverrides = {
  organization_locations?: string[];
  person_locations?: string[];
  person_titles?: string[];
  person_seniorities?: string[];
  q_keywords?: string;
  revenue_range?: { min?: number; max?: number };
  page?: number;
};

export function apolloContactOverridesToPeopleSearch(
  overrides?: ApolloContactSearchOverrides
): ApolloPeopleSearchOverrides {
  if (!overrides) return {};
  const out: ApolloPeopleSearchOverrides = {};
  if (overrides.organization_locations?.length) {
    out.organization_locations = overrides.organization_locations;
  }
  if (overrides.person_locations?.length) out.person_locations = overrides.person_locations;
  if (overrides.person_titles?.length) out.person_titles = overrides.person_titles;
  if (overrides.person_seniorities?.length) out.person_seniorities = overrides.person_seniorities;
  if (overrides.q_keywords?.trim()) out.q_keywords = overrides.q_keywords.trim();
  if (overrides.revenue_range?.min != null) out.revenue_range_min = overrides.revenue_range.min;
  if (overrides.revenue_range?.max != null) out.revenue_range_max = overrides.revenue_range.max;
  if (overrides.page != null) out.page = overrides.page;
  return out;
}

export function formatApolloRefineSearchSummary(overrides?: ApolloContactSearchOverrides): string | null {
  if (!overrides) return null;
  const parts: string[] = [];
  if (overrides.person_titles?.length) parts.push(`titles: ${overrides.person_titles.join(", ")}`);
  if (overrides.person_locations?.length) parts.push(`contact location: ${overrides.person_locations.join(", ")}`);
  if (overrides.organization_locations?.length) {
    parts.push(`HQ: ${overrides.organization_locations.join(", ")}`);
  }
  if (overrides.person_seniorities?.length) {
    parts.push(`seniority: ${overrides.person_seniorities.map((s) => s.replace(/_/g, " ")).join(", ")}`);
  }
  if (overrides.q_keywords?.trim()) parts.push(`keywords: ${overrides.q_keywords.trim()}`);
  if (overrides.revenue_range?.min != null || overrides.revenue_range?.max != null) {
    const min = overrides.revenue_range?.min;
    const max = overrides.revenue_range?.max;
    if (min != null && max != null) parts.push(`revenue $${min.toLocaleString()}–$${max.toLocaleString()}`);
    else if (min != null) parts.push(`revenue min $${min.toLocaleString()}`);
    else if (max != null) parts.push(`revenue max $${max.toLocaleString()}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
