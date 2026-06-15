import type { ApolloContactSearchOverrides } from "@/lib/apollo/search-defaults";

const REVENUE_STORAGE_KEY = "agentdash.apollo.revenue_filter";

export type ApolloRevenueFilterPrefs = {
  revenue_min?: string;
  revenue_max?: string;
  organization_locations?: string;
  person_titles?: string;
  person_locations?: string;
  person_seniorities?: string;
  q_keywords?: string;
};

export function loadApolloRevenueFilterPrefs(): ApolloRevenueFilterPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(REVENUE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ApolloRevenueFilterPrefs;
  } catch {
    return {};
  }
}

export function saveApolloRevenueFilterPrefs(prefs: ApolloRevenueFilterPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REVENUE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function splitCsvField(value?: string): string[] | undefined {
  const items = value
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

export function parseRevenueFilterBody(prefs: ApolloRevenueFilterPrefs): ApolloContactSearchOverrides {
  const min = prefs.revenue_min?.trim() ? Number(prefs.revenue_min.replace(/,/g, "")) : undefined;
  const max = prefs.revenue_max?.trim() ? Number(prefs.revenue_max.replace(/,/g, "")) : undefined;
  const organizationLocations = splitCsvField(prefs.organization_locations);
  const personTitles = splitCsvField(prefs.person_titles);
  const personLocations = splitCsvField(prefs.person_locations);
  const personSeniorities = splitCsvField(prefs.person_seniorities)?.map((s) =>
    s.toLowerCase().replace(/\s+/g, "_")
  );
  const qKeywords = prefs.q_keywords?.trim() || undefined;

  const out: ApolloContactSearchOverrides = {};
  if (min != null && Number.isFinite(min)) out.revenue_range = { ...out.revenue_range, min };
  if (max != null && Number.isFinite(max)) {
    out.revenue_range = { ...out.revenue_range, max };
  }
  if (organizationLocations) out.organization_locations = organizationLocations;
  if (personTitles) out.person_titles = personTitles;
  if (personLocations) out.person_locations = personLocations;
  if (personSeniorities) out.person_seniorities = personSeniorities;
  if (qKeywords) out.q_keywords = qKeywords;
  return out;
}

export function apolloSearchOverridesToPrefs(
  overrides: ApolloContactSearchOverrides
): ApolloRevenueFilterPrefs {
  return {
    revenue_min:
      overrides.revenue_range?.min != null ? String(overrides.revenue_range.min) : undefined,
    revenue_max:
      overrides.revenue_range?.max != null ? String(overrides.revenue_range.max) : undefined,
    organization_locations: overrides.organization_locations?.join(", "),
    person_titles: overrides.person_titles?.join(", "),
    person_locations: overrides.person_locations?.join(", "),
    person_seniorities: overrides.person_seniorities?.map((s) => s.replace(/_/g, " ")).join(", "),
    q_keywords: overrides.q_keywords,
  };
}
