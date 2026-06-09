import type { SupabaseClient } from "@supabase/supabase-js";
import { apolloMaxSeedsPerExpand, apolloMaxResultsPerSeed } from "@/lib/apollo/config";
import { enrichOrganizationByDomainFull, searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";
import type { ApolloOrganizationResult } from "@/lib/apollo/org-search-types";
import {
  domainFromWebsite,
  employeeRangeBracket,
  normalizeDomainForCompare,
  revenueRangeFromSeed,
} from "@/lib/apollo/org-search-utils";

export type ExpandSimilarSeed = {
  company_id: string;
  company_name: string;
  website: string | null;
  apollo_organization_id: string | null;
};

export type ExpandSimilarGroup = {
  seed: ExpandSimilarSeed;
  similar: ApolloOrganizationResult[];
};

export type ExpandSimilarParams = {
  seeds: ExpandSimilarSeed[];
  category?: string | null;
  revenue_range_min?: number;
  revenue_range_max?: number;
  organization_locations?: string[];
  limit_per_seed?: number;
  exclude_domains?: string[];
};

function buildProfileFromEnriched(
  enriched: Awaited<ReturnType<typeof enrichOrganizationByDomainFull>>,
  params: ExpandSimilarParams
): {
  keyword_tags: string[];
  revenue_range_min?: number;
  revenue_range_max?: number;
  organization_num_employees_ranges?: string[];
  organization_locations?: string[];
} {
  const tags = [...enriched.keyword_tags];
  if (params.category?.trim()) tags.push(params.category.trim());
  const rev = revenueRangeFromSeed(enriched.annual_revenue, {
    overrideMin: params.revenue_range_min,
    overrideMax: params.revenue_range_max,
  });
  const profile: ReturnType<typeof buildProfileFromEnriched> = {
    keyword_tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 8),
    revenue_range_min: rev.min,
    revenue_range_max: rev.max,
  };
  if (enriched.estimated_num_employees != null && enriched.estimated_num_employees > 0) {
    profile.organization_num_employees_ranges = [
      employeeRangeBracket(enriched.estimated_num_employees),
    ];
  }
  const locs: string[] = [];
  if (params.organization_locations?.length) {
    locs.push(...params.organization_locations);
  } else {
    if (enriched.state) locs.push(enriched.state);
    if (enriched.country) locs.push(enriched.country);
  }
  if (locs.length > 0) profile.organization_locations = [...new Set(locs.map((l) => l.trim()).filter(Boolean))];
  return profile;
}

export async function expandSimilarCompanies(
  params: ExpandSimilarParams
): Promise<ExpandSimilarGroup[]> {
  const limit = Math.min(
    apolloMaxResultsPerSeed(),
    Math.max(1, params.limit_per_seed ?? 5)
  );
  const maxSeeds = apolloMaxSeedsPerExpand();
  const seeds = params.seeds.slice(0, maxSeeds);

  const exclude = new Set(
    (params.exclude_domains ?? [])
      .map(normalizeDomainForCompare)
      .filter(Boolean)
  );
  for (const s of seeds) {
    const d = normalizeDomainForCompare(domainFromWebsite(s.website));
    if (d) exclude.add(d);
  }

  const groups: ExpandSimilarGroup[] = [];

  for (const seed of seeds) {
    let domain = domainFromWebsite(seed.website);
    if (!domain && seed.company_name) {
      const { organizations } = await searchApolloOrganizationsAdvanced({
        q_organization_name: seed.company_name,
        per_page: 1,
      });
      const match = organizations[0];
      domain =
        normalizeDomainForCompare(match?.primary_domain ?? domainFromWebsite(match?.website)) ||
        null;
    }
    if (!domain) {
      groups.push({ seed, similar: [] });
      continue;
    }

    const enriched = await enrichOrganizationByDomainFull(domain);
    const profile = buildProfileFromEnriched(enriched, params);
    if (profile.keyword_tags.length === 0 && params.category) {
      profile.keyword_tags = [params.category];
    }

    const { organizations } = await searchApolloOrganizationsAdvanced({
      keyword_tags: profile.keyword_tags.length > 0 ? profile.keyword_tags : [seed.company_name],
      revenue_range_min: profile.revenue_range_min,
      revenue_range_max: profile.revenue_range_max,
      organization_locations: profile.organization_locations,
      organization_num_employees_ranges: profile.organization_num_employees_ranges,
      per_page: Math.min(25, limit + exclude.size + 5),
      exclude_domains: [...exclude],
    });

    const seedNameLower = seed.company_name.toLowerCase();
    const similar = organizations
      .filter((o) => o.name.toLowerCase() !== seedNameLower)
      .slice(0, limit);

    for (const o of similar) {
      const d = normalizeDomainForCompare(o.primary_domain ?? domainFromWebsite(o.website));
      if (d) exclude.add(d);
    }

    groups.push({ seed, similar });
  }

  return groups;
}

export async function loadExpandSeedsFromCompanyIds(
  supabaseAdmin: SupabaseClient,
  companyIds: string[]
): Promise<ExpandSimilarSeed[]> {
  const ids = [...new Set(companyIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("company_id, name, website, apollo_organization_id")
    .in("company_id", ids);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    company_id: String(row.company_id),
    company_name: String(row.name ?? "").trim() || "Unknown",
    website: row.website != null ? String(row.website) : null,
    apollo_organization_id:
      row.apollo_organization_id != null ? String(row.apollo_organization_id) : null,
  }));
}

export async function resolveSeedsByName(
  supabaseAdmin: SupabaseClient,
  names: string[]
): Promise<ExpandSimilarSeed[]> {
  const out: ExpandSimilarSeed[] = [];
  for (const name of names) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) continue;
    const { data } = await supabaseAdmin
      .from("companies")
      .select("company_id, name, website, apollo_organization_id")
      .ilike("name", trimmed)
      .limit(1)
      .maybeSingle();
    if (data) {
      out.push({
        company_id: String(data.company_id),
        company_name: String(data.name ?? trimmed),
        website: data.website != null ? String(data.website) : null,
        apollo_organization_id:
          data.apollo_organization_id != null ? String(data.apollo_organization_id) : null,
      });
    } else {
      out.push({
        company_id: "",
        company_name: trimmed,
        website: null,
        apollo_organization_id: null,
      });
    }
  }
  return out;
}
