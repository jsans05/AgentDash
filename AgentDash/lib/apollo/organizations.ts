import { fetchApollo } from "@/lib/apollo/client";
import type {
  ApolloEnrichedOrganization,
  ApolloOrganizationResult,
  ApolloOrganizationSearchFilters,
  ApolloOrganizationSearchResponse,
} from "@/lib/apollo/org-search-types";
import {
  domainFromWebsite,
  mapEnrichedOrganization,
  mapRawOrganization,
  normalizeDomainForCompare,
} from "@/lib/apollo/org-search-utils";

type OrgSearchResponse = {
  organizations?: Array<Record<string, unknown>>;
  accounts?: Array<Record<string, unknown>>;
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
};

function filterExcludedDomains(
  rows: ApolloOrganizationResult[],
  exclude_domains?: string[]
): ApolloOrganizationResult[] {
  if (!exclude_domains?.length) return rows;
  const excluded = new Set(exclude_domains.map(normalizeDomainForCompare).filter(Boolean));
  return rows.filter((r) => {
    const d = normalizeDomainForCompare(r.primary_domain ?? domainFromWebsite(r.website));
    return !d || !excluded.has(d);
  });
}

export async function searchApolloOrganizationsAdvanced(
  filters: ApolloOrganizationSearchFilters
): Promise<ApolloOrganizationSearchResponse> {
  const tags = (filters.keyword_tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  const q: Record<string, string | number | boolean | string[] | undefined> = {
    page: filters.page ?? 1,
    per_page: Math.min(100, Math.max(1, filters.per_page ?? 15)),
  };

  if (tags.length > 0) q.q_organization_keyword_tags = tags;
  if (filters.q_organization_name?.trim()) q.q_organization_name = filters.q_organization_name.trim();
  if (filters.revenue_range_min != null) q["revenue_range[min]"] = filters.revenue_range_min;
  if (filters.revenue_range_max != null) q["revenue_range[max]"] = filters.revenue_range_max;
  if (filters.organization_locations?.length) {
    q.organization_locations = filters.organization_locations;
  }
  if (filters.organization_not_locations?.length) {
    q.organization_not_locations = filters.organization_not_locations;
  }
  if (filters.organization_num_employees_ranges?.length) {
    q.organization_num_employees_ranges = filters.organization_num_employees_ranges;
  }

  const data = await fetchApollo<OrgSearchResponse>("/mixed_companies/search", { query: q });
  const raw = data.organizations ?? data.accounts ?? [];
  const organizations = filterExcludedDomains(
    raw.map((o) => mapRawOrganization(o)),
    filters.exclude_domains
  );

  return {
    organizations,
    pagination: data.pagination,
  };
}

export async function searchApolloOrganizations(
  query: string,
  opts?: { revenue_range_min?: number; revenue_range_max?: number; per_page?: number }
): Promise<Array<{ name: string; industry?: string; website?: string; description?: string }>> {
  const { organizations } = await searchApolloOrganizationsAdvanced({
    keyword_tags: [query.trim()].filter(Boolean),
    revenue_range_min: opts?.revenue_range_min,
    revenue_range_max: opts?.revenue_range_max,
    per_page: opts?.per_page ?? 15,
  });

  return organizations.map((o) => ({
    name: o.name,
    industry: o.industry,
    website: o.website,
    description: o.description,
  }));
}

type OrgEnrichResponse = {
  organization?: Record<string, unknown>;
};

export async function enrichOrganizationByDomainFull(domain: string): Promise<ApolloEnrichedOrganization> {
  const clean = domain.replace(/^www\./i, "").trim();
  const data = await fetchApollo<OrgEnrichResponse>("/organizations/enrich", {
    method: "GET",
    query: { domain: clean },
  });
  const org = data.organization;
  if (!org) {
    return {
      apollo_organization_id: null,
      name: null,
      website: null,
      industry: null,
      description: null,
      primary_domain: clean || null,
      estimated_num_employees: null,
      annual_revenue: null,
      city: null,
      state: null,
      country: null,
      keyword_tags: [],
    };
  }
  return mapEnrichedOrganization(org);
}

export async function enrichOrganizationByDomain(domain: string): Promise<{
  website: string | null;
  industry: string | null;
  description: string | null;
  apollo_organization_id: string | null;
}> {
  const full = await enrichOrganizationByDomainFull(domain);
  return {
    website: full.website,
    industry: full.industry,
    description: full.description,
    apollo_organization_id: full.apollo_organization_id,
  };
}
