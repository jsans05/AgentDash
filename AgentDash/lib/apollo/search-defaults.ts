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

export const APOLLO_DEFAULT_CONTACT_EMAIL_STATUS = ["verified"] as const;

export const APOLLO_DEFAULT_INCLUDE_SIMILAR_TITLES = true;

/** Default Find contacts: partnership/marketing titles + seniorities, verified email only. */
export type ApolloContactSearchMode = "partnership" | "all_verified";

export function formatApolloPartnershipSearchSummary(): string {
  const titles = APOLLO_DEFAULT_PERSON_TITLES.join(", ");
  const seniorities = APOLLO_DEFAULT_PERSON_SENIORITIES.map((s) => s.replace(/_/g, " ")).join(", ");
  return `Job titles containing: ${titles} (similar titles included). Seniority: ${seniorities}. Verified email only.`;
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
