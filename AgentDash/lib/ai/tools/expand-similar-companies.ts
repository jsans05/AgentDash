import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";
import { apolloMaxSeedsPerExpand, isApolloEnabled } from "@/lib/apollo/config";
import {
  expandSimilarCompanies,
  loadExpandSeedsFromCompanyIds,
  resolveSeedsByName,
} from "@/lib/apollo/expand-similar";
import { domainFromWebsite, normalizeDomainForCompare } from "@/lib/apollo/org-search-utils";
import { fetchAthleteTargetListRows } from "@/lib/crm/athlete-target-list-server";

export async function expandSimilarCompaniesForChat(
  supabase: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  profile: Profile,
  params: {
    seed_company_ids?: string[];
    seed_company_names?: string[];
    category?: string | null;
    athlete_id?: string | null;
    limit_per_seed?: number;
    organization_locations?: string[];
    revenue_range_min?: number;
    revenue_range_max?: number;
  }
) {
  if (!isApolloEnabled()) {
    return { error: "Apollo API is not configured on this server." };
  }

  const companyIds = Array.isArray(params.seed_company_ids)
    ? [...new Set(params.seed_company_ids.map((id) => String(id)).filter(Boolean))]
    : [];
  const companyNames = Array.isArray(params.seed_company_names)
    ? params.seed_company_names.map(String).filter(Boolean)
    : [];

  if (companyIds.length === 0 && companyNames.length === 0) {
    return { error: "seed_company_ids or seed_company_names is required" };
  }
  if (companyIds.length + companyNames.length > apolloMaxSeedsPerExpand()) {
    return { error: `Max ${apolloMaxSeedsPerExpand()} seeds per expand request` };
  }

  const byId =
    companyIds.length > 0 ? await loadExpandSeedsFromCompanyIds(supabaseAdmin, companyIds) : [];
  const byName =
    companyNames.length > 0 ? await resolveSeedsByName(supabaseAdmin, companyNames) : [];
  const seeds = [...byId, ...byName].slice(0, apolloMaxSeedsPerExpand());

  const exclude_domains: string[] = [];
  const athleteId = params.athlete_id?.trim();
  if (athleteId) {
    const targetRows = await fetchAthleteTargetListRows(supabase, profile.user_id, athleteId);
    for (const row of targetRows) {
      const d = domainFromWebsite(row.website);
      if (d) exclude_domains.push(d);
    }
  }

  const groups = await expandSimilarCompanies({
    seeds,
    category: params.category?.trim() || undefined,
    revenue_range_min: params.revenue_range_min,
    revenue_range_max: params.revenue_range_max,
    organization_locations: params.organization_locations,
    limit_per_seed: params.limit_per_seed != null ? Number(params.limit_per_seed) : 5,
    exclude_domains: [...new Set(exclude_domains.map(normalizeDomainForCompare).filter(Boolean))],
  });

  return {
    summary: {
      seeds: seeds.length,
      total_similar: groups.reduce((n, g) => n + g.similar.length, 0),
    },
    groups: groups.map((g) => ({
      seed: {
        company_id: g.seed.company_id,
        company_name: g.seed.company_name,
        website: g.seed.website,
      },
      similar: g.similar.map((o) => ({
        name: o.name,
        website: o.website ?? null,
        primary_domain: o.primary_domain ?? null,
        estimated_num_employees: o.estimated_num_employees ?? null,
        annual_revenue: o.annual_revenue ?? null,
      })),
    })),
  };
}
