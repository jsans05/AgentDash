import type { SupabaseClient } from "@supabase/supabase-js";
import { isApolloEnabled } from "@/lib/apollo/config";
import { searchNewsForOrganization } from "@/lib/apollo/news";
import {
  enrichOrganizationByDomainFull,
  getOrganizationById,
  searchApolloOrganizationsAdvanced,
} from "@/lib/apollo/organizations";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import type { ApolloNewsArticle } from "@/lib/apollo/org-search-types";
import { logApolloUsage } from "@/lib/apollo/usage";
import type { AggregatedBrand } from "@/lib/market-intel/queries";
import type { BrandEnrichmentRow } from "@/lib/market-intel/queries";
import { firmographicsFromBrandEnrichment } from "@/lib/crm/company-firmographics";

const SKIP_DOMAIN_SUFFIXES = [
  "nascar.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
];

function isSkippableDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return SKIP_DOMAIN_SUFFIXES.some((suffix) => d === suffix || d.endsWith(`.${suffix}`));
}

export function resolveBrandDomain(brand: AggregatedBrand): string | null {
  const urls = [...brand.teamPlacements, ...brand.venuePlacements]
    .map((p) => p.sponsor_url)
    .filter((url): url is string => Boolean(url?.trim()));

  for (const url of urls) {
    const domain = domainFromWebsite(url);
    if (domain && !isSkippableDomain(domain)) return domain;
  }
  return null;
}

export function buildBrandPersonalNotes(brand: AggregatedBrand): string {
  const teams = [...new Set(brand.teamPlacements.map((p) => p.owner_name))].sort();
  const venues = [...new Set(brand.venuePlacements.map((p) => p.venue_name))].sort();
  const parts: string[] = [];
  if (teams.length) parts.push(teams.join(", "));
  if (venues.length) parts.push(venues.join(", "));
  return `Market intel: ${parts.join("; ")}`;
}

export function brandToTargetListRow(
  brand: AggregatedBrand,
  enrichment?: BrandEnrichmentRow | null
) {
  const domain = resolveBrandDomain(brand);
  return {
    company_name: brand.displayName,
    website: domain ? `https://${domain}` : null,
    personal_notes: buildBrandPersonalNotes(brand),
    ...(enrichment ? firmographicsFromBrandEnrichment(enrichment) : {}),
  };
}

async function resolveDomainForBrand(
  brand: AggregatedBrand,
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const fromPlacements = resolveBrandDomain(brand);
  if (fromPlacements) return fromPlacements;

  const { organizations } = await searchApolloOrganizationsAdvanced({
    q_organization_name: brand.displayName,
    per_page: 5,
  });
  await logApolloUsage(supabaseAdmin, {
    user_id: userId,
    endpoint: "mixed_companies/search",
  });

  const match =
    organizations.find(
      (o) => o.name?.toLowerCase() === brand.displayName.toLowerCase()
    ) ?? organizations[0];
  if (!match) return null;

  const domain =
    match.primary_domain?.trim() || domainFromWebsite(match.website ?? undefined);
  return domain || null;
}

export async function enrichBrand(
  supabaseAdmin: SupabaseClient,
  brand: AggregatedBrand,
  userId: string
): Promise<BrandEnrichmentRow> {
  if (!isApolloEnabled()) {
    throw new Error("Apollo integration is not configured");
  }

  const domain = await resolveDomainForBrand(brand, supabaseAdmin, userId);
  if (!domain) {
    throw new Error(`No website domain found for ${brand.displayName}`);
  }

  const enriched = await enrichOrganizationByDomainFull(domain);
  await logApolloUsage(supabaseAdmin, {
    user_id: userId,
    endpoint: "organizations/enrich",
  });

  const apolloOrgId = enriched.apollo_organization_id;
  if (!apolloOrgId) {
    throw new Error(`Apollo could not match ${brand.displayName} (${domain})`);
  }

  let headcountSix = enriched.headcount_six_month_growth;
  let headcountTwelve = enriched.headcount_twelve_month_growth;
  let headcountTwentyFour = enriched.headcount_twenty_four_month_growth;
  let departmentalHeadCount = enriched.departmental_head_count;
  let estimatedEmployees = enriched.estimated_num_employees;

  if (
    headcountSix == null ||
    headcountTwelve == null ||
    headcountTwentyFour == null
  ) {
    const trends = await getOrganizationById(apolloOrgId);
    await logApolloUsage(supabaseAdmin, {
      user_id: userId,
      endpoint: "organizations/{id}",
    });
    headcountSix = trends.headcount_six_month_growth;
    headcountTwelve = trends.headcount_twelve_month_growth;
    headcountTwentyFour = trends.headcount_twenty_four_month_growth;
    departmentalHeadCount = trends.departmental_head_count ?? departmentalHeadCount;
    estimatedEmployees = trends.estimated_num_employees ?? estimatedEmployees;
  }

  const newsArticles = await searchNewsForOrganization(apolloOrgId, { per_page: 10 });
  await logApolloUsage(supabaseAdmin, {
    user_id: userId,
    endpoint: "news_articles/search",
  });

  const row = {
    company_name_normalized: brand.key,
    display_name: brand.displayName,
    domain: enriched.primary_domain ?? domain,
    apollo_organization_id: apolloOrgId,
    annual_revenue: enriched.annual_revenue,
    annual_revenue_printed: enriched.annual_revenue_printed,
    total_funding: enriched.total_funding,
    total_funding_printed: enriched.total_funding_printed,
    latest_funding_stage: enriched.latest_funding_stage,
    latest_funding_round_date: enriched.latest_funding_round_date,
    funding_events: enriched.funding_events,
    estimated_num_employees: estimatedEmployees,
    industry: enriched.industry,
    headcount_six_month_growth: headcountSix,
    headcount_twelve_month_growth: headcountTwelve,
    headcount_twenty_four_month_growth: headcountTwentyFour,
    departmental_head_count: departmentalHeadCount,
    news_articles: newsArticles as ApolloNewsArticle[],
    enriched_at: new Date().toISOString(),
    enriched_by: userId,
  };

  const { data, error } = await supabaseAdmin
    .from("market_intel_brand_enrichment")
    .upsert(row, { onConflict: "company_name_normalized" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as BrandEnrichmentRow;
}
