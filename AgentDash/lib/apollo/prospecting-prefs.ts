const REVENUE_STORAGE_KEY = "agentdash.apollo.revenue_filter";

export type ApolloRevenueFilterPrefs = {
  revenue_min?: string;
  revenue_max?: string;
  organization_locations?: string;
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

export function parseRevenueFilterBody(prefs: ApolloRevenueFilterPrefs): {
  revenue_range?: { min?: number; max?: number };
  organization_locations?: string[];
} {
  const min = prefs.revenue_min?.trim() ? Number(prefs.revenue_min.replace(/,/g, "")) : undefined;
  const max = prefs.revenue_max?.trim() ? Number(prefs.revenue_max.replace(/,/g, "")) : undefined;
  const locations = prefs.organization_locations
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: {
    revenue_range?: { min?: number; max?: number };
    organization_locations?: string[];
  } = {};
  if (min != null && Number.isFinite(min)) out.revenue_range = { ...out.revenue_range, min };
  if (max != null && Number.isFinite(max)) {
    out.revenue_range = { ...out.revenue_range, max };
  }
  if (locations?.length) out.organization_locations = locations;
  return out;
}
